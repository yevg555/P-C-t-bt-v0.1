/**
 * POLYMARKET COPY TRADING BOT
 * ===========================
 * Main entry point
 *
 * Copies trades from a successful Polymarket trader with configurable
 * paper trading or live trading modes.
 *
 * Flow:
 * 1. Poll trader's positions for changes
 * 2. When a change is detected, calculate copy size
 * 3. Check risk limits
 * 4. Execute order (paper or live)
 */

import * as dotenv from "dotenv";
import * as readline from "readline";
import { PositionPoller } from "./polling";
import { ActivityPoller, TradeEvent } from "./polling/activity-poller";
import { PolymarketAPI, Trade } from "./api/polymarket-api";
import { CopySizeCalculator } from "./strategy/copy-size";
import { RiskChecker, TradingState } from "./strategy/risk-checker";
import { PriceAdjuster } from "./strategy/price-adjuster";
import { TpSlMonitor, TpSlTriggerEvent } from "./strategy/tp-sl-monitor";
import {
  createExecutor,
  getTradingMode,
  PaperTradingExecutor,
} from "./execution";
import {
  PositionChange,
  OrderSpec,
  OrderExecutor,
  SellStrategy,
  OrderType,
  BelowMinLimitAction,
  AutoTpSlConfig,
  TraderConfig,
} from "./types";

/**
 * Polling method determines how we detect trader's trades
 * - 'activity': Poll /activity endpoint for actual trades (recommended)
 *   - Exact timestamps for latency measurement
 *   - Exact execution prices
 *   - Incremental fetching with `after` parameter
 * - 'positions': Poll /positions endpoint and diff (legacy)
 *   - State-based change detection
 *   - No exact trade timestamps
 */
type PollingMethod = "activity" | "positions";

// Load environment variables
dotenv.config();

/**
 * Main bot class that orchestrates all components
 */
class CopyTradingBot {
  // Polling - supports both activity-based and position-based
  private pollingMethod: PollingMethod;
  private positionPoller: PositionPoller | null = null;
  private activityPoller: ActivityPoller | null = null;

  private api: PolymarketAPI;
  private sizeCalculator: CopySizeCalculator;
  private riskChecker: RiskChecker;
  private priceAdjuster: PriceAdjuster;
  private executor: OrderExecutor;
  private tpSlMonitor: TpSlMonitor;

  // Trader configuration with tagging
  private traderConfig: TraderConfig;

  // 1-Click Sell state
  private oneClickSellEnabled: boolean;
  private keyboardListener: readline.Interface | null = null;

  // Price optimization: skip market price fetch when using activity polling
  private useTraderPrice: boolean;

  // Portfolio value prefetch interval
  private portfolioValuePrefetchInterval: NodeJS.Timeout | null = null;

  // Tracking state
  private dailyPnL: number = 0;
  private totalPnL: number = 0;
  private tradeCount: number = 0;

  // Latency tracking
  private latencySamples: Array<{
    detectionLatencyMs: number;
    executionLatencyMs: number;
    totalLatencyMs: number;
  }> = [];
  private maxLatencySamples: number = 100;

  // Clock drift calibration (measured on startup)
  private clockDriftOffset: number = 0;

  constructor() {
    // Validate config
    const traderAddress = process.env.TRADER_ADDRESS;
    if (
      !traderAddress ||
      traderAddress === "0x0000000000000000000000000000000000000000"
    ) {
      console.error("ERROR: Please set TRADER_ADDRESS in your .env file");
      console.log("");
      console.log("1. Copy .env.example to .env:");
      console.log("   cp .env.example .env");
      console.log("");
      console.log("2. Edit .env and add the trader address you want to copy");
      console.log("");
      process.exit(1);
    }

    // Set up trader config with tag
    this.traderConfig = {
      address: traderAddress,
      tag: process.env.TRADER_TAG || undefined,
    };

    const intervalMs = parseInt(process.env.POLLING_INTERVAL_MS || "1000");

    // Initialize components
    this.api = new PolymarketAPI();

    // Choose polling method: activity (recommended) or positions (legacy)
    this.pollingMethod = (process.env.POLLING_METHOD as PollingMethod) || "activity";

    const pollerConfig = {
      traderAddress,
      intervalMs,
      maxConsecutiveErrors: parseInt(
        process.env.MAX_CONSECUTIVE_ERRORS || "5"
      ),
    };

    if (this.pollingMethod === "activity") {
      this.activityPoller = new ActivityPoller(pollerConfig, this.api);
    } else {
      this.positionPoller = new PositionPoller(pollerConfig);
    }

    this.sizeCalculator = new CopySizeCalculator({
      sizingMethod:
        (process.env.SIZING_METHOD as
          | "proportional_to_portfolio"
          | "proportional_to_trader"
          | "fixed") || "proportional_to_portfolio",
      portfolioPercentage: parseFloat(
        process.env.PORTFOLIO_PERCENTAGE || "0.05"
      ),
      priceOffsetBps: parseInt(process.env.PRICE_OFFSET_BPS || "50"),
      minOrderSize: parseInt(process.env.MIN_ORDER_SIZE || "5"), // Polymarket min is 5
      maxPositionPerToken: parseInt(
        process.env.MAX_POSITION_PER_TOKEN || "1000"
      ),
      maxTotalPosition: 5000,
      // SELL and order configuration
      sellStrategy: (process.env.SELL_STRATEGY as SellStrategy) || "proportional",
      orderType: (process.env.ORDER_TYPE as OrderType) || "limit",
      orderExpirationSeconds: parseInt(process.env.ORDER_EXPIRATION_SECONDS || "30"),
      // Below min limit action
      belowMinLimitAction: (process.env.BELOW_MIN_LIMIT_ACTION as BelowMinLimitAction) || "buy_at_min",
    });

    this.riskChecker = new RiskChecker({
      maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || "100"),
      maxTotalLoss: parseFloat(process.env.MAX_TOTAL_LOSS || "500"),
      // Spending limits
      maxTokenSpend: parseFloat(process.env.MAX_TOKEN_SPEND || "0"),
      maxMarketSpend: parseFloat(process.env.MAX_MARKET_SPEND || "0"),
      totalHoldingsLimit: parseFloat(process.env.TOTAL_HOLDINGS_LIMIT || "0"),
    });

    this.priceAdjuster = new PriceAdjuster(
      parseInt(process.env.PRICE_OFFSET_BPS || "50")
    );

    // Create executor based on TRADING_MODE
    this.executor = createExecutor({
      paperBalance: parseFloat(process.env.PAPER_TRADING_BALANCE || "1000"),
    });

    // Initialize Auto TP/SL monitor
    const tpSlConfig: AutoTpSlConfig = {
      enabled: process.env.AUTO_TP_SL_ENABLED === "true",
      takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT || "0.10"),
      stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || "0.05"),
    };
    this.tpSlMonitor = new TpSlMonitor(tpSlConfig);

    // 1-Click Sell configuration
    this.oneClickSellEnabled = process.env.ONE_CLICK_SELL_ENABLED !== "false";

    // Price optimization: use trader's execution price instead of fetching market price
    // Only effective when using activity polling (which provides exact trade prices)
    this.useTraderPrice = process.env.USE_TRADER_PRICE === "true";

    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for the poller
   */
  private setupEventHandlers(): void {
    if (this.activityPoller) {
      // Activity-based polling (recommended)
      this.activityPoller.on("trade", async (event: TradeEvent) => {
        await this.handleTradeEvent(event);
      });

      this.activityPoller.on("error", (error: Error) => {
        console.error(`[BOT] Poller error: ${error.message}`);
      });

      this.activityPoller.on("degraded", (errorCount: number) => {
        console.log("");
        console.log("WARNING: Bot is in degraded state");
        console.log("   Check your internet connection and API status");
        console.log(`   Consecutive errors: ${errorCount}`);
        console.log("");
      });

      this.activityPoller.on("recovered", () => {
        console.log("[BOT] Poller recovered from errors");
      });
    } else if (this.positionPoller) {
      // Position-based polling (legacy)
      this.positionPoller.on("change", async (change: PositionChange) => {
        await this.handlePositionChange(change);
      });

      this.positionPoller.on("error", (error: Error) => {
        console.error(`[BOT] Poller error: ${error.message}`);
      });

      this.positionPoller.on("degraded", (errorCount: number) => {
        console.log("");
        console.log("WARNING: Bot is in degraded state");
        console.log("   Check your internet connection and API status");
        console.log(`   Consecutive errors: ${errorCount}`);
        console.log("");
      });

      this.positionPoller.on("recovered", () => {
        console.log("[BOT] Poller recovered from errors");
      });
    }

    // TP/SL trigger handler
    this.tpSlMonitor.on("trigger", async (event: TpSlTriggerEvent) => {
      await this.handleTpSlTrigger(event);
    });
  }

  /**
   * Handle a trade event from the ActivityPoller
   * This is the recommended method - provides exact timestamps and prices
   */
  private async handleTradeEvent(event: TradeEvent): Promise<void> {
    const { trade, latency } = event;
    const executionStartTime = Date.now();
    const traderTag = this.traderConfig.tag || this.traderConfig.address.slice(0, 10);

    console.log("");
    console.log("=".repeat(60));
    console.log(`[${traderTag}] TRADE DETECTED: ${trade.side} ${trade.size.toFixed(2)} shares @ $${trade.price.toFixed(4)}`);
    console.log(`Token: ${trade.tokenId.slice(0, 20)}...`);
    if (trade.marketTitle) {
      console.log(`Market: ${trade.marketTitle}`);
    }
    console.log(`Trade Time: ${trade.timestamp.toISOString()}`);

    // Show calibrated detection latency if drift correction is significant
    if (Math.abs(this.clockDriftOffset) > 1) {
      const detectionLatencyCorrected = latency.detectionLatencyMs - this.clockDriftOffset;
      console.log(`Detection Latency: ${detectionLatencyCorrected.toFixed(0)}ms (calibrated, raw: ${latency.detectionLatencyMs}ms)`);
    } else {
      console.log(`Detection Latency: ${latency.detectionLatencyMs}ms`);
    }
    console.log("=".repeat(60));

    // Convert Trade to PositionChange for compatibility with existing code
    // For activity polling, we use the actual trade data
    const change: PositionChange = {
      tokenId: trade.tokenId,
      marketId: trade.marketId,
      side: trade.side,
      delta: trade.size,
      // For activity polling, we don't have the previous/current position quantities
      // Use the trade size as delta
      previousQuantity: trade.side === "BUY" ? 0 : trade.size,
      currentQuantity: trade.side === "BUY" ? trade.size : 0,
      detectedAt: latency.detectedAt,
      marketTitle: trade.marketTitle,
      curPrice: trade.price,
    };

    // Get our current position in this token (needed for SELL calculations)
    const yourPosition = await this.executor.getPosition(trade.tokenId);

    // Step 1: Should we copy this trade?
    const shouldCopy = this.sizeCalculator.shouldCopy(change, yourPosition);
    if (!shouldCopy.copy) {
      console.log(`[SKIP] ${shouldCopy.reason}`);
      return;
    }

    // Steps 2+3: Fetch price, balance, and portfolio value IN PARALLEL
    // These are independent operations — running them concurrently saves ~50-100ms
    let currentPrice = trade.price;
    console.log(`[PRICE] Trader's execution price: $${currentPrice.toFixed(4)}`);

    const [priceResult, balance, traderPortfolioValueResult] = await Promise.all([
      // Price fetch (skip if using trader price)
      this.useTraderPrice
        ? Promise.resolve({ price: trade.price, usedTraderPrice: true })
        : this.api.getPrice(trade.tokenId, trade.side)
            .then(price => ({ price, usedTraderPrice: false }))
            .catch(() => ({ price: trade.price, usedTraderPrice: true, failed: true })),
      // Balance fetch
      this.executor.getBalance(),
      // Portfolio value fetch (try cache first, then API)
      (async (): Promise<number | undefined> => {
        const cached = this.api.getCachedPortfolioValue(this.traderConfig.address);
        if (cached !== undefined) return cached;
        try {
          return await this.api.getPortfolioValue(this.traderConfig.address);
        } catch (error) {
          console.warn(`[SIZE] Could not get trader portfolio value: ${error}`);
          return undefined;
        }
      })(),
    ]);

    // Apply price result
    if (priceResult.usedTraderPrice) {
      if ((priceResult as { failed?: boolean }).failed) {
        console.log(`[PRICE] Using trader's price (market fetch failed)`);
      } else {
        console.log(`[PRICE] Using trader's price (USE_TRADER_PRICE=true)`);
      }
    } else {
      const priceDiff = ((priceResult.price - trade.price) / trade.price * 100).toFixed(2);
      console.log(`[PRICE] Current market price: $${priceResult.price.toFixed(4)} (${priceDiff}% from trade)`);
    }
    currentPrice = priceResult.price;

    const traderPortfolioValue = traderPortfolioValueResult;

    const sizeResult = this.sizeCalculator.calculate({
      change,
      currentPrice,
      yourBalance: balance,
      yourPosition,
      traderPortfolioValue,
    });

    console.log(`[SIZE] ${sizeResult.reason}`);
    if (sizeResult.adjustments.length > 0) {
      sizeResult.adjustments.forEach((adj) => console.log(`  - ${adj}`));
    }

    if (sizeResult.shares === 0) {
      console.log("[SKIP] Calculated size is 0");
      return;
    }

    // Step 4: Adjust price for better fill
    const adjustedPrice = this.priceAdjuster.adjust(currentPrice, trade.side);
    const priceDetails = this.priceAdjuster.getAdjustmentDetails(
      currentPrice,
      trade.side,
      sizeResult.shares
    );
    console.log(`[PRICE] ${priceDetails.description}`);

    // Step 5: Create order spec
    const orderConfig = this.sizeCalculator.getOrderConfig();
    const expiresInMs = orderConfig.expirationSeconds * 1000;

    const order: OrderSpec = {
      tokenId: trade.tokenId,
      side: trade.side,
      size: sizeResult.shares,
      price: adjustedPrice,
      orderType: orderConfig.orderType,
      expiresInMs: expiresInMs > 0 ? expiresInMs : undefined,
      expiresAt: expiresInMs > 0 ? new Date(Date.now() + expiresInMs) : undefined,
      priceOffsetBps: orderConfig.priceOffsetBps,
      triggeredBy: change,
    };

    console.log(`[ORDER] Type: ${order.orderType?.toUpperCase()}, Expires: ${order.expiresInMs ? `${orderConfig.expirationSeconds}s` : 'GTC'}`);

    // Step 6: Risk check (pass cached balance to avoid redundant fetch)
    const tradingState = await this.getTradingState(balance);
    const riskResult = this.riskChecker.check(order, tradingState);

    if (!riskResult.approved) {
      console.log(`[RISK] REJECTED: ${riskResult.reason}`);
      return;
    }

    if (riskResult.warnings.length > 0) {
      console.log(`[RISK] Warnings:`);
      riskResult.warnings.forEach((w) => console.log(`  - ${w}`));
    }

    console.log(`[RISK] Approved (level: ${riskResult.riskLevel})`);

    // Step 7: Execute the order
    console.log(`[EXEC] Executing ${order.side} ${order.size} @ $${order.price.toFixed(4)}...`);

    try {
      const result = await this.executor.execute(order);

      const executionEndTime = Date.now();
      const executionLatencyMs = executionEndTime - executionStartTime;
      const totalLatencyMs = executionEndTime - trade.timestamp.getTime();

      // Apply clock drift calibration
      const detectionLatencyCorrected = latency.detectionLatencyMs - this.clockDriftOffset;
      const totalLatencyCorrected = totalLatencyMs - this.clockDriftOffset;

      // Record latency sample (use corrected values)
      this.recordLatencySample(detectionLatencyCorrected, executionLatencyMs, totalLatencyCorrected);

      if (result.status === "filled") {
        this.tradeCount++;
        console.log(`[EXEC] FILLED: ${result.filledSize} shares @ $${result.avgFillPrice?.toFixed(4) || order.price.toFixed(4)}`);
        console.log(`[EXEC] Order ID: ${result.orderId}`);
        console.log(`[EXEC] Mode: ${result.executionMode.toUpperCase()}`);

        // Show calibrated latency
        if (Math.abs(this.clockDriftOffset) > 1) {
          console.log(`[LATENCY] Detection: ${detectionLatencyCorrected.toFixed(0)}ms | Execution: ${executionLatencyMs}ms | Total: ${totalLatencyCorrected.toFixed(0)}ms (calibrated)`);
        } else {
          console.log(`[LATENCY] Detection: ${latency.detectionLatencyMs}ms | Execution: ${executionLatencyMs}ms | Total: ${totalLatencyMs}ms`);
        }
      } else {
        console.log(`[EXEC] ${result.status.toUpperCase()}: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error(`[EXEC] Execution failed: ${error}`);
    }

    console.log("=".repeat(60));
    console.log("");
  }

  /**
   * Record a latency sample for statistics
   */
  private recordLatencySample(detectionLatencyMs: number, executionLatencyMs: number, totalLatencyMs: number): void {
    this.latencySamples.push({ detectionLatencyMs, executionLatencyMs, totalLatencyMs });
    if (this.latencySamples.length > this.maxLatencySamples) {
      this.latencySamples.shift();
    }
  }

  /**
   * Get latency statistics (already calibrated with clock drift offset)
   */
  getLatencyStats(): {
    avgDetectionMs: number;
    avgExecutionMs: number;
    avgTotalMs: number;
    sampleCount: number;
    clockDriftOffset: number;
  } {
    if (this.latencySamples.length === 0) {
      return {
        avgDetectionMs: 0,
        avgExecutionMs: 0,
        avgTotalMs: 0,
        sampleCount: 0,
        clockDriftOffset: this.clockDriftOffset,
      };
    }

    const sumDetection = this.latencySamples.reduce((a, b) => a + b.detectionLatencyMs, 0);
    const sumExecution = this.latencySamples.reduce((a, b) => a + b.executionLatencyMs, 0);
    const sumTotal = this.latencySamples.reduce((a, b) => a + b.totalLatencyMs, 0);
    const count = this.latencySamples.length;

    return {
      avgDetectionMs: Math.round(sumDetection / count),
      avgExecutionMs: Math.round(sumExecution / count),
      avgTotalMs: Math.round(sumTotal / count),
      sampleCount: count,
      clockDriftOffset: this.clockDriftOffset,
    };
  }

  /**
   * Handle Auto TP/SL trigger
   */
  private async handleTpSlTrigger(event: TpSlTriggerEvent): Promise<void> {
    const traderTag = this.traderConfig.tag || this.traderConfig.address.slice(0, 10);

    console.log("");
    console.log("=".repeat(60));
    console.log(`[${traderTag}] AUTO ${event.triggerType.toUpperCase().replace("_", " ")} TRIGGERED`);
    console.log(`Token: ${event.tokenId.slice(0, 20)}...`);
    console.log(`Entry: $${event.entryPrice.toFixed(4)} -> Current: $${event.currentPrice.toFixed(4)}`);
    console.log(`Change: ${(event.percentChange * 100).toFixed(2)}%`);
    console.log("=".repeat(60));

    try {
      const result = await this.executor.execute(event.order);

      if (result.status === "filled") {
        this.tradeCount++;
        console.log(`[TP/SL] SELL FILLED: ${result.filledSize} shares @ $${result.avgFillPrice?.toFixed(4)}`);
      } else {
        console.log(`[TP/SL] SELL ${result.status.toUpperCase()}: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error(`[TP/SL] Execution failed: ${error}`);
    }

    console.log("=".repeat(60));
    console.log("");
  }

  /**
   * Handle a detected position change
   */
  private async handlePositionChange(change: PositionChange): Promise<void> {
    const startTime = Date.now();
    const traderTag = this.traderConfig.tag || this.traderConfig.address.slice(0, 10);

    console.log("");
    console.log("=".repeat(60));
    console.log(`[${traderTag}] TRADE DETECTED: ${change.side} ${change.delta.toFixed(2)} shares`);
    console.log(`Token: ${change.tokenId.slice(0, 20)}...`);
    if (change.marketTitle) {
      console.log(`Market: ${change.marketTitle}`);
    }
    console.log("=".repeat(60));

    // Get our current position in this token (needed for SELL calculations)
    const yourPosition = await this.executor.getPosition(change.tokenId);

    // Step 1: Should we copy this trade?
    const shouldCopy = this.sizeCalculator.shouldCopy(change, yourPosition);
    if (!shouldCopy.copy) {
      console.log(`[SKIP] ${shouldCopy.reason}`);
      return;
    }

    // Step 2: Get current market price
    let currentPrice: number;
    try {
      currentPrice = await this.api.getPrice(change.tokenId, change.side);
      console.log(`[PRICE] Market price: $${currentPrice.toFixed(4)}`);
    } catch (error) {
      console.error(`[ERROR] Failed to get price: ${error}`);
      // Fall back to curPrice from change if available
      if (change.curPrice && change.curPrice > 0) {
        currentPrice = change.curPrice;
        console.log(`[PRICE] Using cached price: $${currentPrice.toFixed(4)}`);
      } else {
        console.log("[SKIP] Cannot determine price");
        return;
      }
    }

    // Step 3: Calculate copy size
    const balance = await this.executor.getBalance();

    // Get trader portfolio value for proportional_to_trader sizing
    // Try cached value first (sync, zero latency), fallback to API call
    let traderPortfolioValue: number | undefined =
      this.api.getCachedPortfolioValue(this.traderConfig.address);

    if (traderPortfolioValue === undefined) {
      try {
        traderPortfolioValue = await this.api.getPortfolioValue(this.traderConfig.address);
      } catch (error) {
        // Non-fatal: calculator will use fallback if undefined
        console.warn(`[SIZE] Could not get trader portfolio value: ${error}`);
      }
    }

    const sizeResult = this.sizeCalculator.calculate({
      change,
      currentPrice,
      yourBalance: balance,
      yourPosition,
      traderPortfolioValue,
    });

    console.log(`[SIZE] ${sizeResult.reason}`);
    if (sizeResult.adjustments.length > 0) {
      sizeResult.adjustments.forEach((adj) => console.log(`  - ${adj}`));
    }

    if (sizeResult.shares === 0) {
      console.log("[SKIP] Calculated size is 0");
      return;
    }

    // Step 4: Adjust price for better fill
    const adjustedPrice = this.priceAdjuster.adjust(currentPrice, change.side);
    const priceDetails = this.priceAdjuster.getAdjustmentDetails(
      currentPrice,
      change.side,
      sizeResult.shares
    );
    console.log(`[PRICE] ${priceDetails.description}`);

    // Step 5: Create order spec
    const orderConfig = this.sizeCalculator.getOrderConfig();
    const expiresInMs = orderConfig.expirationSeconds * 1000;

    const order: OrderSpec = {
      tokenId: change.tokenId,
      side: change.side,
      size: sizeResult.shares,
      price: adjustedPrice,
      orderType: orderConfig.orderType,
      expiresInMs: expiresInMs > 0 ? expiresInMs : undefined,
      expiresAt: expiresInMs > 0 ? new Date(Date.now() + expiresInMs) : undefined,
      priceOffsetBps: orderConfig.priceOffsetBps,
      triggeredBy: change,
    };

    console.log(`[ORDER] Type: ${order.orderType?.toUpperCase()}, Expires: ${order.expiresInMs ? `${orderConfig.expirationSeconds}s` : 'GTC'}`);

    // Step 6: Risk check
    const tradingState = await this.getTradingState();
    const riskResult = this.riskChecker.check(order, tradingState);

    if (!riskResult.approved) {
      console.log(`[RISK] REJECTED: ${riskResult.reason}`);
      return;
    }

    if (riskResult.warnings.length > 0) {
      console.log(`[RISK] Warnings:`);
      riskResult.warnings.forEach((w) => console.log(`  - ${w}`));
    }

    console.log(`[RISK] Approved (level: ${riskResult.riskLevel})`);

    // Step 7: Execute the order
    console.log(`[EXEC] Executing ${order.side} ${order.size} @ $${order.price.toFixed(4)}...`);

    try {
      const result = await this.executor.execute(order);

      const latency = Date.now() - startTime;

      if (result.status === "filled") {
        this.tradeCount++;
        console.log(`[EXEC] FILLED: ${result.filledSize} shares @ $${result.avgFillPrice?.toFixed(4) || order.price.toFixed(4)}`);
        console.log(`[EXEC] Order ID: ${result.orderId}`);
        console.log(`[EXEC] Mode: ${result.executionMode.toUpperCase()}`);
        console.log(`[EXEC] Latency: ${latency}ms (detection → execution)`);
      } else {
        console.log(`[EXEC] ${result.status.toUpperCase()}: ${result.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error(`[EXEC] Execution failed: ${error}`);
    }

    console.log("=".repeat(60));
    console.log("");
  }

  /**
   * Get current trading state for risk checks
   * @param cachedBalance - Optional pre-fetched balance to avoid redundant API call
   */
  private async getTradingState(cachedBalance?: number): Promise<TradingState> {
    const balance = cachedBalance ?? await this.executor.getBalance();
    const positions = await this.executor.getAllPositions();

    let totalShares = 0;
    for (const qty of positions.values()) {
      totalShares += qty;
    }

    // Get P&L from paper executor if available
    if (this.executor instanceof PaperTradingExecutor) {
      this.totalPnL = this.executor.getTotalPnL();
      this.dailyPnL = this.totalPnL; // For now, daily = total (no daily reset)
    }

    // Get spend tracker if available
    const spendTracker = this.executor.getSpendTracker?.();

    return {
      dailyPnL: this.dailyPnL,
      totalPnL: this.totalPnL,
      balance,
      positions,
      totalShares,
      spendTracker,
    };
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    console.log("");
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║          POLYMARKET COPY TRADING BOT v2.0                 ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");
    console.log("");

    const orderConfig = this.sizeCalculator.getOrderConfig();
    const copyConfig = this.sizeCalculator.getConfig();
    const riskConfig = this.riskChecker.getConfig();
    const tpSlConfig = this.tpSlMonitor.getConfig();
    const traderDisplay = this.traderConfig.tag
      ? `${this.traderConfig.tag} (${this.traderConfig.address.slice(0, 10)}...)`
      : `${this.traderConfig.address.slice(0, 10)}...`;

    console.log(`  Mode:            ${getTradingMode().toUpperCase()}`);
    console.log(`  Trader:          ${traderDisplay}`);
    console.log(`  Polling Method:  ${this.pollingMethod.toUpperCase()}`);
    console.log(`  Poll Interval:   ${process.env.POLLING_INTERVAL_MS || 1000}ms`);
    console.log(`  Sizing:          ${process.env.SIZING_METHOD || "proportional_to_portfolio"}`);
    console.log(`  Portfolio %:     ${(parseFloat(process.env.PORTFOLIO_PERCENTAGE || "0.05") * 100).toFixed(1)}%`);
    console.log(`  SELL Strategy:   ${process.env.SELL_STRATEGY || "proportional"}`);
    console.log(`  Order Type:      ${orderConfig.orderType.toUpperCase()}`);
    console.log(`  Order Expiry:    ${orderConfig.expirationSeconds > 0 ? `${orderConfig.expirationSeconds}s` : 'GTC'}`);
    console.log(`  Price Offset:    ${orderConfig.priceOffsetBps} bps (${(orderConfig.priceOffsetBps / 100).toFixed(2)}%)`);
    console.log(`  Starting Balance: $${(await this.executor.getBalance()).toFixed(2)}`);
    console.log("");

    // Display new feature settings
    console.log("  --- Feature Settings ---");
    console.log(`  Below Min Action: ${copyConfig.belowMinLimitAction?.toUpperCase() || "SKIP"}`);
    console.log(`  Min Order Size:   ${copyConfig.minOrderSize} shares`);

    // Spending limits
    if (riskConfig.maxTokenSpend && riskConfig.maxTokenSpend > 0) {
      console.log(`  Max Token Spend:  $${riskConfig.maxTokenSpend}`);
    }
    if (riskConfig.maxMarketSpend && riskConfig.maxMarketSpend > 0) {
      console.log(`  Max Market Spend: $${riskConfig.maxMarketSpend}`);
    }
    if (riskConfig.totalHoldingsLimit && riskConfig.totalHoldingsLimit > 0) {
      console.log(`  Holdings Limit:   $${riskConfig.totalHoldingsLimit}`);
    }

    // TP/SL settings
    console.log(`  Auto TP/SL:       ${tpSlConfig.enabled ? "ENABLED" : "DISABLED"}`);
    if (tpSlConfig.enabled) {
      console.log(`    Take Profit:    +${((tpSlConfig.takeProfitPercent || 0) * 100).toFixed(1)}%`);
      console.log(`    Stop Loss:      -${((tpSlConfig.stopLossPercent || 0) * 100).toFixed(1)}%`);
    }

    // 1-Click Sell
    console.log(`  1-Click Sell:     ${this.oneClickSellEnabled ? "ENABLED (press 'q')" : "DISABLED"}`);
    console.log("");

    // Run startup tests
    console.log("  --- Startup Tests ---");
    await this.runStartupTests();
    console.log("");

    // Start the appropriate poller
    if (this.activityPoller) {
      await this.activityPoller.start();
    } else if (this.positionPoller) {
      await this.positionPoller.start();
    }

    // Prefetch trader portfolio value and start periodic refresh
    // This ensures low latency for proportional_to_trader sizing
    await this.startPortfolioValuePrefetch();

    // Start TP/SL monitoring if enabled
    if (tpSlConfig.enabled && this.executor instanceof PaperTradingExecutor) {
      this.startTpSlMonitoring();
    }

    // Set up 1-Click Sell keyboard handler
    if (this.oneClickSellEnabled) {
      this.setupOneClickSell();
    }

    console.log("Press Ctrl+C to stop" + (this.oneClickSellEnabled ? ", 'q' to sell all positions" : ""));
    console.log("");
  }

  /**
   * Run startup tests to validate system readiness
   */
  private async runStartupTests(): Promise<void> {
    // Test 1: Clock Synchronization
    try {
      const clockSync = await this.api.checkClockSync();

      // Store the drift offset for automatic calibration
      this.clockDriftOffset = clockSync.drift;

      if (clockSync.synchronized) {
        console.log(`  Clock Sync:       ✅ SYNCHRONIZED (drift: ${clockSync.drift >= 0 ? '+' : ''}${clockSync.drift.toFixed(1)}ms)`);
        if (Math.abs(clockSync.drift) > 10) {
          console.log(`                    Auto-calibration enabled - latency adjusted by ${clockSync.drift >= 0 ? '+' : ''}${clockSync.drift.toFixed(1)}ms`);
        }
      } else {
        const driftAbs = Math.abs(clockSync.drift);
        if (driftAbs < 500) {
          console.log(`  Clock Sync:       ⚠️  WARNING (drift: ${clockSync.drift >= 0 ? '+' : ''}${clockSync.drift.toFixed(1)}ms)`);
          console.log(`                    Auto-calibration enabled - measurements will be corrected`);
        } else if (driftAbs < 2000) {
          console.log(`  Clock Sync:       ⚠️  SIGNIFICANT DRIFT (${clockSync.drift >= 0 ? '+' : ''}${clockSync.drift.toFixed(1)}ms)`);
          console.log(`                    Auto-calibration enabled, but recommend syncing clock`);
          console.log(`                    Run: sudo ntpdate -s time.nist.gov`);
        } else {
          console.log(`  Clock Sync:       ❌ CRITICAL (drift: ${clockSync.drift >= 0 ? '+' : ''}${(clockSync.drift/1000).toFixed(2)}s)`);
          console.log(`                    Auto-calibration may not be accurate with large drift!`);
          console.log(`                    URGENT: Run: sudo ntpdate -s time.nist.gov`);
        }
      }
    } catch (error) {
      console.log(`  Clock Sync:       ⚠️  UNABLE TO CHECK`);
      console.log(`                    ${error instanceof Error ? error.message : String(error)}`);
      console.log(`                    Auto-calibration disabled - drift offset = 0ms`);
      this.clockDriftOffset = 0;
    }

    // Test 2: API Connectivity (already tested by clock sync, just report it)
    try {
      // Quick connectivity test
      await this.api.getTrades(this.traderConfig.address, { limit: 1 });
      console.log(`  API Connectivity: ✅ OK`);
    } catch (error) {
      console.log(`  API Connectivity: ❌ FAILED`);
      console.log(`                    ${error instanceof Error ? error.message : String(error)}`);
      throw new Error("API connectivity test failed. Cannot start bot.");
    }
  }

  /**
   * Start portfolio value prefetching for low-latency trader portfolio lookups
   */
  private async startPortfolioValuePrefetch(): Promise<void> {
    const traderAddress = this.traderConfig.address;

    // Initial fetch
    try {
      const portfolioValue = await this.api.getPortfolioValue(traderAddress);
      const traderTag = this.traderConfig.tag || traderAddress.slice(0, 10);
      console.log(`[PREFETCH] Trader ${traderTag} portfolio value: $${portfolioValue.toFixed(2)}`);
    } catch (error) {
      console.warn(`[PREFETCH] Could not fetch trader portfolio value: ${error}`);
    }

    // Set up periodic prefetch (every 30 seconds to keep cache warm)
    const prefetchIntervalMs = 30000;
    this.portfolioValuePrefetchInterval = setInterval(async () => {
      try {
        await this.api.prefetchPortfolioValue(traderAddress);
      } catch {
        // Silently ignore prefetch errors
      }
    }, prefetchIntervalMs);
  }

  /**
   * Start TP/SL monitoring
   */
  private startTpSlMonitoring(): void {
    if (!(this.executor instanceof PaperTradingExecutor)) {
      return;
    }

    const executor = this.executor;

    this.tpSlMonitor.startMonitoring(
      async () => executor.getAllPositionDetails(),
      async (tokenIds: string[]) => {
        const prices = new Map<string, number>();
        for (const tokenId of tokenIds) {
          try {
            // Get price for monitoring (use BUY side as reference)
            const price = await this.api.getPrice(tokenId, "SELL");
            prices.set(tokenId, price);
          } catch {
            // Skip if price fetch fails
          }
        }
        return prices;
      }
    );
  }

  /**
   * Set up 1-Click Sell keyboard handler
   */
  private setupOneClickSell(): void {
    // Only works in TTY mode
    if (!process.stdin.isTTY) {
      console.log("[1-Click Sell] Not available (not running in TTY mode)");
      return;
    }

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    process.stdin.on("keypress", async (str, key) => {
      // Handle Ctrl+C
      if (key.ctrl && key.name === "c") {
        process.emit("SIGINT");
        return;
      }

      // Handle 'q' for 1-Click Sell
      if (key.name === "q") {
        await this.executeOneClickSell();
      }
    });
  }

  /**
   * Execute 1-Click Sell - sell all positions immediately
   */
  private async executeOneClickSell(): Promise<void> {
    if (!(this.executor instanceof PaperTradingExecutor)) {
      console.log("[1-Click Sell] Only available in paper trading mode");
      return;
    }

    const executor = this.executor;
    const positions = await executor.getAllPositionDetails();

    if (positions.size === 0) {
      console.log("\n[1-Click Sell] No positions to sell\n");
      return;
    }

    // Get current prices for all positions
    const currentPrices = new Map<string, number>();
    for (const [tokenId, position] of positions) {
      try {
        const price = await this.api.getPrice(tokenId, "SELL");
        currentPrices.set(tokenId, price);
      } catch {
        // Use avgPrice as fallback
        currentPrices.set(tokenId, position.avgPrice);
      }
    }

    // Execute sell all
    const results = await executor.sellAllPositions(currentPrices);

    // Update trade count
    this.tradeCount += results.filter((r) => r.status === "filled").length;
  }

  /**
   * Stop the bot
   */
  stop(): void {
    if (this.activityPoller) {
      this.activityPoller.stop();
    } else if (this.positionPoller) {
      this.positionPoller.stop();
    }
    this.tpSlMonitor.stopMonitoring();

    // Stop portfolio value prefetching
    if (this.portfolioValuePrefetchInterval) {
      clearInterval(this.portfolioValuePrefetchInterval);
      this.portfolioValuePrefetchInterval = null;
    }

    // Clean up keyboard listener
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }

  /**
   * Get bot statistics
   */
  getStats(): {
    pollerStats: ReturnType<PositionPoller["getStats"]> | ReturnType<ActivityPoller["getStats"]>;
    tradeCount: number;
    totalPnL: number;
    dailyPnL: number;
    mode: string;
    pollingMethod: PollingMethod;
    latencyStats: ReturnType<CopyTradingBot["getLatencyStats"]>;
  } {
    const pollerStats = this.activityPoller
      ? this.activityPoller.getStats()
      : this.positionPoller?.getStats() || {
          isRunning: false,
          isPaused: false,
          pollCount: 0,
          changesDetected: 0,
          cacheSize: 0,
          consecutiveErrors: 0,
          lastPollTime: null,
          traderAddress: this.traderConfig.address,
        };

    return {
      pollerStats,
      tradeCount: this.tradeCount,
      totalPnL: this.totalPnL,
      dailyPnL: this.dailyPnL,
      mode: getTradingMode(),
      pollingMethod: this.pollingMethod,
      latencyStats: this.getLatencyStats(),
    };
  }

  /**
   * Get the executor (for testing/debugging)
   */
  getExecutor(): OrderExecutor {
    return this.executor;
  }
}

// ============================================
// MAIN ENTRY POINT
// ============================================

async function main() {
  const bot = new CopyTradingBot();

  // Graceful shutdown handler
  const shutdown = async () => {
    console.log("");
    console.log("Shutting down...");
    bot.stop();

    const stats = bot.getStats();
    const pollerStats = stats.pollerStats;
    const tradesDetected = 'tradesDetected' in pollerStats
      ? pollerStats.tradesDetected
      : ('changesDetected' in pollerStats ? pollerStats.changesDetected : 0);

    console.log("");
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║                   SESSION SUMMARY                         ║");
    console.log("╠═══════════════════════════════════════════════════════════╣");
    console.log(`║  Mode:              ${stats.mode.toUpperCase().padEnd(38)}║`);
    console.log(`║  Polling Method:    ${stats.pollingMethod.toUpperCase().padEnd(38)}║`);
    console.log(`║  Polls completed:   ${String(pollerStats.pollCount).padEnd(38)}║`);
    console.log(`║  Trades detected:   ${String(tradesDetected).padEnd(38)}║`);
    console.log(`║  Trades executed:   ${String(stats.tradeCount).padEnd(38)}║`);
    console.log(`║  Total P&L:         $${stats.totalPnL.toFixed(2).padEnd(36)}║`);
    if (stats.latencyStats.sampleCount > 0) {
      const latencyLabel = Math.abs(stats.latencyStats.clockDriftOffset) > 1
        ? `${stats.latencyStats.avgTotalMs}ms (calibrated)`
        : `${stats.latencyStats.avgTotalMs}ms`;
      console.log(`║  Avg Latency:       ${String(latencyLabel).padEnd(38)}║`);
      if (Math.abs(stats.latencyStats.clockDriftOffset) > 1) {
        const driftSign = stats.latencyStats.clockDriftOffset >= 0 ? '+' : '';
        console.log(`║  Clock Drift:       ${String(driftSign + stats.latencyStats.clockDriftOffset.toFixed(1) + 'ms corrected').padEnd(38)}║`);
      }
    }
    console.log("╚═══════════════════════════════════════════════════════════╝");

    // If paper trading, show detailed summary
    const executor = bot.getExecutor();
    if (executor instanceof PaperTradingExecutor) {
      const summary = executor.getSummary();
      const trades = executor.getTrades();

      console.log("");
      console.log("Paper Trading Details:");
      console.log(`  Starting Balance: $${summary.initialBalance.toFixed(2)}`);
      console.log(`  Final Balance:    $${summary.balance.toFixed(2)}`);
      console.log(`  Total P&L:        $${summary.totalPnL.toFixed(2)}`);
      console.log(`  Trade Count:      ${trades.length}`);
      console.log(`  Open Positions:   ${summary.positionCount}`);

      if (trades.length > 0) {
        console.log("");
        console.log("Recent Trades:");
        trades.slice(-5).forEach((trade, i) => {
          console.log(
            `  ${i + 1}. ${trade.side} ${trade.size} @ $${trade.price.toFixed(4)} = $${trade.cost.toFixed(2)}`
          );
        });
      }
    }

    console.log("");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start the bot
  await bot.start();
}

// Run!
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
