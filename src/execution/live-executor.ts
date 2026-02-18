/**
 * LIVE TRADING EXECUTOR
 * =====================
 * Executes real orders on Polymarket via the CLOB API.
 *
 * Uses @polymarket/clob-client for:
 * - EIP-712 order signing
 * - Order submission (limit + market orders)
 * - Order status polling
 * - Order cancellation
 * - Balance/allowance checking
 *
 * Authentication flow:
 * 1. Private key → ethers Wallet (L1 auth)
 * 2. Wallet → derive API credentials (L2 auth)
 * 3. Full ClobClient with L1 + L2 for trading
 */

import { Wallet } from "@ethersproject/wallet";
import {
  ClobClient,
  ApiKeyCreds,
  Side as ClobSide,
  OrderType as ClobOrderType,
  AssetType,
} from "@polymarket/clob-client";
import { SignatureType } from "@polymarket/order-utils";

import {
  OrderSpec,
  OrderResult,
  OrderExecutor,
  TradingMode,
  PaperPosition,
  SpendTracker,
} from "../types";
import { withRetry, CircuitBreaker, checkSlippage } from "../utils";

/**
 * Configuration for live trading
 */
export interface LiveExecutorConfig {
  /** Your private key (hex, with or without 0x prefix) */
  privateKey: string;
  /** Your Polymarket proxy/funder wallet address */
  funderAddress: string;
  /** Signature type: 0=EOA, 1=POLY_PROXY, 2=POLY_GNOSIS_SAFE */
  signatureType: number;
  /** CLOB API endpoint */
  clobApiUrl?: string;
  /** Chain ID (137=Polygon mainnet, 80002=Amoy testnet) */
  chainId?: number;
  /** Pre-generated API credentials (optional — will auto-derive if not provided) */
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
  /** Extra seconds to poll beyond order expiration for expiring orders (default: 5) */
  orderFillPollBufferSeconds?: number;
  /** Max seconds to poll for GTC orders that have no expiration (default: 300) */
  gtcFillTimeoutSeconds?: number;
  /** Polling interval for checking order status (ms, default: 1000) */
  orderStatusPollIntervalMs?: number;
  /** Maximum acceptable slippage in basis points (default: 200 = 2%) */
  maxSlippageBps?: number;
  /** Max API retries on transient failures (default: 3) */
  maxRetries?: number;
}

/**
 * Live trading executor — executes real orders on Polymarket
 */
export class LiveTradingExecutor implements OrderExecutor {
  private config: LiveExecutorConfig;
  private client: ClobClient | null = null;
  private wallet: Wallet | null = null;
  private isInitialized: boolean = false;
  private orderCounter: number = 0;

  // Position tracking (mirrors paper executor for TP/SL + 1-Click Sell)
  private positions: Map<string, PaperPosition> = new Map();
  private spendTracker: SpendTracker = {
    tokenSpend: new Map(),
    marketSpend: new Map(),
    totalHoldingsValue: 0,
  };
  private tokenToMarket: Map<string, string> = new Map();
  private totalPnL: number = 0;

  // Robustness: circuit breaker for API calls
  private circuitBreaker: CircuitBreaker = new CircuitBreaker(5, 30_000);

  // Balance cache: avoids ~50-100ms API call on every trade
  // Invalidated after each trade execution
  private cachedBalance: number | null = null;
  private cachedBalanceTimestamp: number = 0;
  private balanceCacheTtlMs: number = 10_000; // 10s TTL

  constructor(config: LiveExecutorConfig) {
    this.config = config;
  }

  /**
   * Initialize the executor: create wallet, derive API creds, build ClobClient
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const chainId = this.config.chainId ?? 137;
    const clobApiUrl = this.config.clobApiUrl ?? "https://clob.polymarket.com";

    // Step 1: Create wallet from private key
    const privateKey = this.config.privateKey.startsWith("0x")
      ? this.config.privateKey
      : `0x${this.config.privateKey}`;

    this.wallet = new Wallet(privateKey);
    const signerAddress = await this.wallet.getAddress();
    console.log(`[LIVE] Signer address: ${signerAddress}`);
    console.log(`[LIVE] Funder address: ${this.config.funderAddress}`);

    // Map signature type number to enum
    const sigType = this.config.signatureType as SignatureType;

    // Step 2: Get API credentials
    let creds: ApiKeyCreds;

    if (this.config.apiKey && this.config.apiSecret && this.config.apiPassphrase) {
      // Use pre-configured credentials
      creds = {
        key: this.config.apiKey,
        secret: this.config.apiSecret,
        passphrase: this.config.apiPassphrase,
      };
      console.log("[LIVE] Using pre-configured API credentials");
    } else {
      // Auto-derive credentials from private key
      console.log("[LIVE] Deriving API credentials from private key...");
      const tempClient = new ClobClient(clobApiUrl, chainId, this.wallet);
      try {
        creds = await tempClient.createOrDeriveApiKey();
        console.log("[LIVE] API credentials derived successfully");
      } catch (error) {
        throw new Error(
          `Failed to derive API credentials: ${error instanceof Error ? error.message : String(error)}. ` +
          `Make sure your private key is correct and has interacted with Polymarket.`
        );
      }
    }

    // Step 3: Create fully authenticated client
    this.client = new ClobClient(
      clobApiUrl,
      chainId,
      this.wallet,
      creds,
      sigType,
      this.config.funderAddress,
    );

    // Step 4: Verify connectivity
    try {
      await this.client.getOk();
      console.log("[LIVE] CLOB API connection verified");
    } catch (error) {
      throw new Error(
        `CLOB API connectivity check failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Step 5: Check USDC balance and allowance
    try {
      const balanceAllowance = await this.client.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });
      const balance = parseFloat(balanceAllowance.balance) / 1e6; // USDC has 6 decimals
      const allowance = parseFloat(balanceAllowance.allowance) / 1e6;

      console.log(`[LIVE] USDC Balance: $${balance.toFixed(2)}`);
      console.log(`[LIVE] USDC Allowance: $${allowance.toFixed(2)}`);

      if (balance <= 0) {
        console.warn("[LIVE] WARNING: Zero USDC balance — you won't be able to place BUY orders");
      }
      if (allowance <= 0) {
        console.warn("[LIVE] WARNING: Zero USDC allowance — run updateBalanceAllowance() or approve on-chain");
        // Try to update allowance automatically
        try {
          await this.client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
          console.log("[LIVE] Allowance refreshed successfully");
        } catch {
          console.warn("[LIVE] Could not auto-refresh allowance — you may need to approve on-chain");
        }
      }
    } catch (error) {
      console.warn(`[LIVE] Could not check balance/allowance: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.isInitialized = true;
    console.log("[LIVE] Live executor initialized and ready");
  }

  /**
   * Execute a real order on Polymarket
   */
  async execute(order: OrderSpec): Promise<OrderResult> {
    this.ensureInitialized();

    const orderId = this.generateOrderId();
    const placedAt = new Date();

    // Circuit breaker check
    if (!this.circuitBreaker.allowRequest()) {
      console.error(`[LIVE] Circuit breaker OPEN — rejecting order (${this.circuitBreaker.getFailures()} consecutive failures)`);
      return {
        orderId,
        status: "failed",
        filledSize: 0,
        error: "Circuit breaker open — too many consecutive API failures",
        placedAt,
        executedAt: new Date(),
        executionMode: "live",
        orderType: order.orderType,
      };
    }

    try {
      const side = order.side === "BUY" ? ClobSide.BUY : ClobSide.SELL;
      const isMarketOrder = order.orderType === "market";

      console.log(`[LIVE] Submitting ${isMarketOrder ? "MARKET" : "LIMIT"} ${order.side} order: ${order.size} shares @ $${order.price.toFixed(4)}`);

      // Submit order with retry on transient failures
      const maxRetries = this.config.maxRetries ?? 3;
      let response: any;

      if (isMarketOrder) {
        response = await withRetry(
          () => this.client!.createAndPostMarketOrder(
            {
              tokenID: order.tokenId,
              price: order.price,
              amount: order.side === "BUY"
                ? order.size * order.price
                : order.size,
              side,
            },
            undefined,
            ClobOrderType.FOK,
          ),
          { maxRetries },
        );
      } else {
        const orderType = order.expiresInMs && order.expiresInMs > 0
          ? ClobOrderType.GTD
          : ClobOrderType.GTC;

        const userOrder: any = {
          tokenID: order.tokenId,
          price: order.price,
          size: order.size,
          side,
        };

        if (orderType === ClobOrderType.GTD && order.expiresInMs) {
          const minExpiration = Math.floor(Date.now() / 1000) + 60;
          const requestedExpiration = Math.floor((Date.now() + order.expiresInMs) / 1000);
          userOrder.expiration = Math.max(requestedExpiration, minExpiration);
        }

        response = await withRetry(
          () => this.client!.createAndPostOrder(
            userOrder,
            undefined,
            orderType,
          ),
          { maxRetries },
        );
      }

      // Parse response
      const executedAt = new Date();
      console.log(`[LIVE] Order response:`, JSON.stringify(response, null, 2));

      if (!response || !response.success) {
        // Record failure BEFORE returning — structured API rejections must count
        this.circuitBreaker.recordFailure();
        const errorMsg = response?.errorMsg || "Unknown error from CLOB API";
        console.error(`[LIVE] Order rejected: ${errorMsg}`);
        return {
          orderId,
          status: "failed",
          filledSize: 0,
          error: errorMsg,
          placedAt,
          executedAt,
          executionMode: "live",
          orderType: order.orderType,
        };
      }

      this.circuitBreaker.recordSuccess();

      const clobOrderId = response.orderID || orderId;
      const status = response.status || "live";

      // Determine fill status
      if (status === "matched") {
        // Fully filled immediately
        const filledSize = order.size;
        const fillPrice = order.price;

        // Slippage check for immediate fills
        const slippage = checkSlippage(order.side, order.price, fillPrice, this.config.maxSlippageBps ?? 200);
        if (!slippage.acceptable) {
          console.warn(`[LIVE] ${slippage.description}`);
          // Log warning but don't reject — the fill already happened on-chain
        }

        this.trackPosition(order, filledSize, fillPrice);

        return {
          orderId: clobOrderId,
          status: "filled",
          filledSize,
          avgFillPrice: fillPrice,
          placedAt,
          executedAt,
          executionMode: "live",
          orderType: order.orderType,
        };
      }

      if (status === "live" || status === "delayed" || status === "unmatched") {
        // Order is resting on the book — poll for fill
        console.log(`[LIVE] Order ${clobOrderId} is ${status}, polling for fill...`);
        return await this.pollOrderStatus(clobOrderId, order, placedAt);
      }

      // Unknown status
      return {
        orderId: clobOrderId,
        status: "pending",
        filledSize: 0,
        placedAt,
        executedAt,
        executionMode: "live",
        orderType: order.orderType,
      };
    } catch (error) {
      this.circuitBreaker.recordFailure();
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[LIVE] Order execution failed: ${errorMsg} (circuit breaker: ${this.circuitBreaker.getState()})`);

      return {
        orderId,
        status: "failed",
        filledSize: 0,
        error: errorMsg,
        placedAt,
        executedAt: new Date(),
        executionMode: "live",
        orderType: order.orderType,
      };
    }
  }

  /**
   * Poll order status until filled, expired, or timeout
   */
  private async pollOrderStatus(
    clobOrderId: string,
    originalOrder: OrderSpec,
    placedAt: Date,
  ): Promise<OrderResult> {
    // Derive poll timeout from the order's expiration when set,
    // or use a separate GTC timeout for non-expiring orders
    const timeoutMs = originalOrder.expiresInMs
      ? originalOrder.expiresInMs + (this.config.orderFillPollBufferSeconds ?? 5) * 1000
      : (this.config.gtcFillTimeoutSeconds ?? 300) * 1000;
    const pollIntervalMs = this.config.orderStatusPollIntervalMs ?? 1000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await this.sleep(pollIntervalMs);

      try {
        const orderStatus = await this.client!.getOrder(clobOrderId);

        if (!orderStatus) continue;

        const status = orderStatus.status?.toLowerCase();
        const originalSize = parseFloat(orderStatus.original_size || "0");
        const sizeMatched = parseFloat(orderStatus.size_matched || "0");
        const price = parseFloat(orderStatus.price || "0");

        if (status === "matched" || (sizeMatched > 0 && sizeMatched >= originalSize)) {
          // Fully filled — check slippage
          const slippage = checkSlippage(originalOrder.side, originalOrder.price, price, this.config.maxSlippageBps ?? 200);
          if (!slippage.acceptable) {
            console.warn(`[LIVE] ${slippage.description}`);
          }
          this.trackPosition(originalOrder, sizeMatched, price);

          return {
            orderId: clobOrderId,
            status: "filled",
            filledSize: sizeMatched,
            avgFillPrice: price,
            placedAt,
            executedAt: new Date(),
            executionMode: "live",
            orderType: originalOrder.orderType,
          };
        }

        if (sizeMatched > 0 && sizeMatched < originalSize) {
          // Partially filled — keep polling until full or timeout
          console.log(`[LIVE] Partial fill: ${sizeMatched}/${originalSize} shares`);
          continue;
        }

        if (status === "cancelled" || status === "canceled") {
          return {
            orderId: clobOrderId,
            status: "cancelled",
            filledSize: sizeMatched,
            avgFillPrice: sizeMatched > 0 ? price : undefined,
            placedAt,
            executedAt: new Date(),
            executionMode: "live",
            orderType: originalOrder.orderType,
          };
        }
      } catch (error) {
        console.warn(`[LIVE] Status poll error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Timeout — cancel the order and return partial result
    console.log(`[LIVE] Order ${clobOrderId} timed out after ${timeoutMs / 1000}s, cancelling...`);
    try {
      await this.client!.cancelOrder({ orderID: clobOrderId });
      console.log(`[LIVE] Order ${clobOrderId} cancelled`);
    } catch (error) {
      console.warn(`[LIVE] Failed to cancel order: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Check final status after cancel
    try {
      const finalStatus = await this.client!.getOrder(clobOrderId);
      const sizeMatched = parseFloat(finalStatus?.size_matched || "0");
      const price = parseFloat(finalStatus?.price || "0");

      if (sizeMatched > 0) {
        this.trackPosition(originalOrder, sizeMatched, price);

        return {
          orderId: clobOrderId,
          status: "partial",
          filledSize: sizeMatched,
          remainingSize: originalOrder.size - sizeMatched,
          avgFillPrice: price,
          placedAt,
          executedAt: new Date(),
          executionMode: "live",
          orderType: originalOrder.orderType,
          expired: true,
        };
      }
    } catch {
      // Ignore — return expired
    }

    return {
      orderId: clobOrderId,
      status: "expired",
      filledSize: 0,
      placedAt,
      executedAt: new Date(),
      executionMode: "live",
      orderType: originalOrder.orderType,
      expired: true,
    };
  }

  /**
   * Track position locally after a fill (for TP/SL + 1-Click Sell + risk)
   */
  private trackPosition(order: OrderSpec, filledSize: number, fillPrice: number): void {
    // Invalidate balance cache — balance changed due to fill
    this.cachedBalance = null;

    const cost = filledSize * fillPrice;

    if (order.side === "BUY") {
      const existing = this.positions.get(order.tokenId);
      if (existing) {
        const totalQuantity = existing.quantity + filledSize;
        const totalCost = existing.totalCost + cost;
        existing.quantity = totalQuantity;
        existing.totalCost = totalCost;
        existing.avgPrice = totalCost / totalQuantity;
      } else {
        const marketId = order.triggeredBy?.marketId;
        this.positions.set(order.tokenId, {
          tokenId: order.tokenId,
          quantity: filledSize,
          avgPrice: fillPrice,
          totalCost: cost,
          marketId,
          entryPrice: fillPrice,
          openedAt: new Date(),
        });
        if (marketId) {
          this.tokenToMarket.set(order.tokenId, marketId);
        }
      }

      // Track spend
      const currentTokenSpend = this.spendTracker.tokenSpend.get(order.tokenId) || 0;
      this.spendTracker.tokenSpend.set(order.tokenId, currentTokenSpend + cost);

      const marketId = order.triggeredBy?.marketId || this.tokenToMarket.get(order.tokenId);
      if (marketId) {
        const currentMarketSpend = this.spendTracker.marketSpend.get(marketId) || 0;
        this.spendTracker.marketSpend.set(marketId, currentMarketSpend + cost);
      }
    } else {
      // SELL
      const position = this.positions.get(order.tokenId);
      if (position) {
        const sellSize = Math.min(filledSize, position.quantity);
        const proceeds = sellSize * fillPrice;
        const costBasis = position.avgPrice * sellSize;
        const tradePnL = proceeds - costBasis;
        this.totalPnL += tradePnL;

        position.quantity -= sellSize;
        position.totalCost -= costBasis;

        if (position.quantity <= 0) {
          this.positions.delete(order.tokenId);
        }
      }
    }

    this.updateTotalHoldingsValue();
  }

  private updateTotalHoldingsValue(): void {
    let total = 0;
    for (const position of this.positions.values()) {
      total += position.totalCost;
    }
    this.spendTracker.totalHoldingsValue = total;
  }

  /**
   * Get current USDC balance
   * Uses caching (10s TTL) to avoid ~50-100ms API call on every trade.
   * Cache is invalidated after each trade execution.
   */
  async getBalance(): Promise<number> {
    // Check cache first
    if (this.cachedBalance !== null && Date.now() - this.cachedBalanceTimestamp < this.balanceCacheTtlMs) {
      return this.cachedBalance;
    }

    this.ensureInitialized();

    try {
      const balanceAllowance = await this.client!.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });
      const balance = parseFloat(balanceAllowance.balance) / 1e6;

      // Cache the result
      this.cachedBalance = balance;
      this.cachedBalanceTimestamp = Date.now();

      return balance;
    } catch (error) {
      // Return cached value as fallback if available
      if (this.cachedBalance !== null) {
        console.warn(`[LIVE] getBalance failed, using cached value: $${this.cachedBalance.toFixed(2)}`);
        return this.cachedBalance;
      }
      console.error(`[LIVE] getBalance failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get position for a token (shares held)
   */
  async getPosition(tokenId: string): Promise<number> {
    // Check local tracking first
    const local = this.positions.get(tokenId);
    if (local) return local.quantity;

    // Fall back to on-chain query
    this.ensureInitialized();
    try {
      const balanceAllowance = await this.client!.getBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
        token_id: tokenId,
      });
      return parseFloat(balanceAllowance.balance) / 1e6;
    } catch {
      return 0;
    }
  }

  /**
   * Get all positions from local tracking
   */
  async getAllPositions(): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const [tokenId, position] of this.positions) {
      result.set(tokenId, position.quantity);
    }
    return result;
  }

  /**
   * Get detailed position info for a single token
   */
  getPositionDetails(tokenId: string): PaperPosition | undefined {
    return this.positions.get(tokenId);
  }

  /**
   * Get all position details (for TP/SL monitoring)
   */
  async getAllPositionDetails(): Promise<Map<string, PaperPosition>> {
    return new Map(this.positions);
  }

  /**
   * Get spend tracker for risk checks
   */
  getSpendTracker(): SpendTracker {
    return {
      tokenSpend: new Map(this.spendTracker.tokenSpend),
      marketSpend: new Map(this.spendTracker.marketSpend),
      totalHoldingsValue: this.spendTracker.totalHoldingsValue,
    };
  }

  /**
   * Get total P&L
   */
  getTotalPnL(): number {
    return this.totalPnL;
  }

  /**
   * Cancel all open orders (kill switch)
   */
  async cancelAllOrders(): Promise<void> {
    this.ensureInitialized();
    try {
      await this.client!.cancelAll();
      console.log("[LIVE] All open orders cancelled");
    } catch (error) {
      console.error(`[LIVE] cancelAll failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Sell all positions (1-Click Sell / Kill Switch)
   */
  async sellAllPositions(currentPrices: Map<string, number>): Promise<OrderResult[]> {
    this.ensureInitialized();
    const results: OrderResult[] = [];
    const positionEntries = Array.from(this.positions.entries());

    if (positionEntries.length === 0) {
      console.log("[LIVE] No positions to sell");
      return results;
    }

    console.log(`\n${"!".repeat(50)}`);
    console.log("!!! 1-CLICK SELL ACTIVATED - SELLING ALL POSITIONS !!!");
    console.log(`${"!".repeat(50)}\n`);

    // Cancel all open orders first
    try {
      await this.cancelAllOrders();
    } catch {
      console.warn("[LIVE] Could not cancel open orders before sell-all");
    }

    for (const [tokenId, position] of positionEntries) {
      const price = currentPrices.get(tokenId) || position.avgPrice;

      const order: OrderSpec = {
        tokenId,
        side: "SELL",
        size: position.quantity,
        price,
        orderType: "market",
      };

      try {
        const result = await this.execute(order);
        results.push(result);
      } catch (error) {
        console.error(`[LIVE] Failed to sell ${tokenId}: ${error}`);
        results.push({
          orderId: `FAILED-${tokenId}`,
          status: "failed",
          filledSize: 0,
          error: String(error),
          executedAt: new Date(),
          executionMode: "live",
        });
      }
    }

    console.log(`\n[LIVE] 1-Click Sell Complete: ${results.filter(r => r.status === "filled").length}/${positionEntries.length} positions closed\n`);
    return results;
  }

  /**
   * Get trading mode
   */
  getMode(): TradingMode {
    return "live";
  }

  /**
   * Check if executor is ready
   */
  async isReady(): Promise<boolean> {
    return this.isInitialized;
  }

  /**
   * Get the underlying CLOB client (for advanced usage)
   */
  getClobClient(): ClobClient | null {
    return this.client;
  }

  // === Private helpers ===

  private ensureInitialized(): void {
    if (!this.isInitialized || !this.client) {
      throw new Error(
        "Live executor not initialized. Call initialize() first."
      );
    }
  }

  private generateOrderId(): string {
    this.orderCounter++;
    return `LIVE-${Date.now()}-${this.orderCounter}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
