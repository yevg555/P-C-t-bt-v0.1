import { EventEmitter } from 'eventemitter3';
import { PublicClient } from 'viem';
import { CTF_EXCHANGE_ABI, CTF_EXCHANGE_ADDRESS, NEG_RISK_CTF_EXCHANGE_ADDRESS } from './abi';
import { Trade, PolymarketAPI } from '../api/polymarket-api';

/**
 * Latency metrics for a detected trade
 */
export interface TradeLatency {
  /** Time from trade execution to our detection (ms) */
  detectionLatencyMs: number;
  /** Timestamp when trade actually happened on Polymarket */
  tradeTimestamp: Date;
  /** Timestamp when we detected the trade */
  detectedAt: Date;
}

/**
 * Trade event with latency info
 */
export interface TradeEvent {
  trade: Trade;
  latency: TradeLatency;
}

export interface TrackerConfig {
  traderAddresses: string[];
  copyMakerOrders?: boolean;
}

export class Tracker extends EventEmitter {
  private traderAddresses: Set<string>;
  private client: PublicClient;
  private api: PolymarketAPI;
  private copyMakerOrders: boolean;

  private unwatchCtf: (() => void) | null = null;
  private unwatchNegRisk: (() => void) | null = null;

  private isRunning = false;
  private lastBlock = 0n;
  private tradesDetected = 0;
  private consecutiveErrors = 0;

  // Cache for token -> market ID lookup to prevent repeated API calls
  private marketIdCache: Map<string, string> = new Map();

  constructor(config: TrackerConfig, client: PublicClient, api: PolymarketAPI) {
    super();
    this.traderAddresses = new Set(config.traderAddresses.map(a => a.toLowerCase()));
    this.client = client;
    this.api = api;
    this.copyMakerOrders = config.copyMakerOrders || false;
  }

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[Tracker] Starting WebSocket listener...');
    console.log(`[Tracker] Copy Maker Orders: ${this.copyMakerOrders}`);

    try {
      // Subscribe to CTF Exchange (Legacy / Binary)
      this.unwatchCtf = this.client.watchContractEvent({
        address: CTF_EXCHANGE_ADDRESS,
        abi: CTF_EXCHANGE_ABI,
        eventName: 'OrderFilled',
        onLogs: logs => this.handleLogs(logs, 'CTF Exchange'),
        onError: err => this.handleError(err)
      });

      // Subscribe to Neg Risk CTF Exchange (Current / Multi-outcome)
      this.unwatchNegRisk = this.client.watchContractEvent({
        address: NEG_RISK_CTF_EXCHANGE_ADDRESS,
        abi: CTF_EXCHANGE_ABI,
        eventName: 'OrderFilled',
        onLogs: logs => this.handleLogs(logs, 'Neg Risk Exchange'),
        onError: err => this.handleError(err)
      });

      console.log(`[Tracker] Listening for trades from ${this.traderAddresses.size} address(es)`);
    } catch (error) {
       this.handleError(error as Error);
    }
  }

  stop() {
    if (this.unwatchCtf) this.unwatchCtf();
    if (this.unwatchNegRisk) this.unwatchNegRisk();
    this.isRunning = false;
    console.log('[Tracker] Stopped listener');
  }

  private handleLogs(logs: any[], source: string) {
    // Process logs
    for (const log of logs) {
       this.processLog(log).catch(err => {
         console.error(`[Tracker] Failed to process log: ${err}`);
       });
    }
    if (logs.length > 0) {
      this.lastBlock = logs[logs.length-1].blockNumber;
    }
    this.consecutiveErrors = 0; // Reset errors on success
  }

  private async processLog(log: any) {
    const { args, transactionHash } = log;
    const maker = args.maker.toLowerCase();
    const taker = args.taker.toLowerCase();

    const isMaker = this.traderAddresses.has(maker);
    const isTaker = this.traderAddresses.has(taker);

    // Filter out unrelated trades
    if (!isMaker && !isTaker) return;

    // Filter Maker orders if configured to skip them
    // (Maker orders are passive limit orders filled by someone else;
    // copying them typically results in adverse selection/latency arbitrage against us)
    if (isMaker && !this.copyMakerOrders) {
      return;
    }

    this.tradesDetected++;

    // Decode trade details
    const makerAssetId = args.makerAssetId; // BigInt
    const takerAssetId = args.takerAssetId; // BigInt
    const makerAmountFilled = args.makerAmountFilled; // BigInt
    const takerAmountFilled = args.takerAmountFilled; // BigInt

    // Identify USDC (Asset ID 0)
    // Note: makerAssetId is BigInt, check against 0n
    const isMakerUSDC = makerAssetId === 0n;
    const isTakerUSDC = takerAssetId === 0n;

    // Determine Side, Token, Size, Price
    let side: "BUY" | "SELL";
    let tokenId: string;
    let size: number; // Token amount
    let usdcAmount: number;

    if (isMaker) {
       if (isMakerUSDC) {
          side = "BUY";
          tokenId = takerAssetId.toString();
          usdcAmount = Number(makerAmountFilled) / 1e6; // USDC has 6 decimals
          size = this.normalizeTokenAmount(takerAmountFilled);
       } else {
          side = "SELL";
          tokenId = makerAssetId.toString();
          usdcAmount = Number(takerAmountFilled) / 1e6; // Taker gives USDC
          size = this.normalizeTokenAmount(makerAmountFilled);
       }
    } else {
       // I am Taker
       if (isTakerUSDC) {
          side = "BUY";
          tokenId = makerAssetId.toString();
          usdcAmount = Number(takerAmountFilled) / 1e6;
          size = this.normalizeTokenAmount(makerAmountFilled);
       } else {
          side = "SELL";
          tokenId = takerAssetId.toString();
          usdcAmount = Number(makerAmountFilled) / 1e6;
          size = this.normalizeTokenAmount(takerAmountFilled);
       }
    }

    // Resolve Market ID (Condition ID)
    // Critical for risk management (MAX_MARKET_SPEND)
    let marketId = this.marketIdCache.get(tokenId) || "";

    if (!marketId) {
      try {
        marketId = await this.api.getMarketId(tokenId);
        if (marketId) {
          this.marketIdCache.set(tokenId, marketId);
        }
      } catch (err) {
        console.warn(`[Tracker] Could not fetch market ID for ${tokenId}: ${err}`);
      }
    }

    // Calculate Price
    const price = size > 0 ? usdcAmount / size : 0;

    // Create Trade object
    const trade: Trade = {
      id: `${transactionHash}-${args.orderHash}`, // Unique ID
      tokenId,
      marketId,
      side,
      size,
      price,
      timestamp: new Date(), // Use current time as approximation
      transactionHash,
      marketTitle: "", // Still missing title, but marketId helps risk checks
      outcome: ""
    };

    // Latency
    const detectedAt = new Date();
    // We don't know exact trade timestamp without fetching block, assume near-instant for listener
    const latency: TradeLatency = {
        detectionLatencyMs: 0,
        tradeTimestamp: detectedAt,
        detectedAt
    };

    const event: TradeEvent = { trade, latency };
    this.emit('trade', event);
  }

  private normalizeTokenAmount(amount: bigint): number {
      // Standardize to float.
      // CTF tokens usually match collateral decimals (USDC = 6) on Polygon.
      // Note: Some docs mention 18 decimals, but standard Gnosis CTF with USDC.e uses 6.
      return Number(amount) / 1e6;
  }

  private handleError(err: Error) {
    this.consecutiveErrors++;
    console.error(`[Tracker] Error: ${err.message}`);
    this.emit('error', err);
  }

  getStats() {
    return {
       isRunning: this.isRunning,
       tradesDetected: this.tradesDetected,
       lastBlock: this.lastBlock.toString(),
       consecutiveErrors: this.consecutiveErrors,
       // Dashboard compatibility
       pollCount: Number(this.lastBlock),
       changesDetected: this.tradesDetected
    };
  }
}
