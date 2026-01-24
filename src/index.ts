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
import { PolymarketAPI } from "./api/polymarket-api";
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

// Load environment variables
dotenv.config();

/**
 * Main bot class that orchestrates all components
 */
class CopyTradingBot {
  private poller: PositionPoller;
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

  // Portfolio value prefetch interval
  private portfolioValuePrefetchInterval: NodeJS.Timeout | null = null;

  // Tracking state
  private dailyPnL: number = 0;
  private totalPnL: number = 0;
  private tradeCount: number = 0;

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

    this.poller = new PositionPoller({
      traderAddress,
      intervalMs,
      maxConsecutiveErrors: parseInt(
        process.env.MAX_CONSECUTIVE_ERRORS || "5"
      ),
    });

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

    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for the poller
   */
  private setupEventHandlers(): void {
    // Main event: when trader's position changes
    this.poller.on("change", async (change: PositionChange) => {
      await this.handlePositionChange(change);
    });

    this.poller.on("error", (error: Error) => {
      console.error(`[BOT] Poller error: ${error.message}`);
    });

    this.poller.on("degraded", (errorCount: number) => {
      console.log("");
      console.log("WARNING: Bot is in degraded state");
      console.log("   Check your internet connection and API status");
      console.log(`   Consecutive errors: ${errorCount}`);
      console.log("");
    });

    this.poller.on("recovered", () => {
      console.log("[BOT] Poller recovered from errors");
    });

    // TP/SL trigger handler
    this.tpSlMonitor.on("trigger", async (event: TpSlTriggerEvent) => {
      await this.handleTpSlTrigger(event);
    });
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
   */
  private async getTradingState(): Promise<TradingState> {
    const balance = await this.executor.getBalance();
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

    await this.poller.start();

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
    this.poller.stop();
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
    pollerStats: ReturnType<PositionPoller["getStats"]>;
    tradeCount: number;
    totalPnL: number;
    dailyPnL: number;
    mode: string;
  } {
    return {
      pollerStats: this.poller.getStats(),
      tradeCount: this.tradeCount,
      totalPnL: this.totalPnL,
      dailyPnL: this.dailyPnL,
      mode: getTradingMode(),
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
    console.log("");
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║                   SESSION SUMMARY                         ║");
    console.log("╠═══════════════════════════════════════════════════════════╣");
    console.log(`║  Mode:              ${stats.mode.toUpperCase().padEnd(38)}║`);
    console.log(`║  Polls completed:   ${String(stats.pollerStats.pollCount).padEnd(38)}║`);
    console.log(`║  Changes detected:  ${String(stats.pollerStats.changesDetected).padEnd(38)}║`);
    console.log(`║  Trades executed:   ${String(stats.tradeCount).padEnd(38)}║`);
    console.log(`║  Total P&L:         $${stats.totalPnL.toFixed(2).padEnd(36)}║`);
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
