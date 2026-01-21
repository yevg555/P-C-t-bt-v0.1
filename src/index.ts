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
import { PositionPoller } from "./polling";
import { PolymarketAPI } from "./api/polymarket-api";
import { CopySizeCalculator } from "./strategy/copy-size";
import { RiskChecker, TradingState } from "./strategy/risk-checker";
import { PriceAdjuster } from "./strategy/price-adjuster";
import {
  createExecutor,
  getTradingMode,
  PaperTradingExecutor,
} from "./execution";
import { PositionChange, OrderSpec, OrderExecutor, SellStrategy, OrderType } from "./types";

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
      minOrderSize: parseInt(process.env.MIN_ORDER_SIZE || "10"),
      maxPositionPerToken: parseInt(
        process.env.MAX_POSITION_PER_TOKEN || "1000"
      ),
      maxTotalPosition: 5000,
      // SELL and order configuration
      sellStrategy: (process.env.SELL_STRATEGY as SellStrategy) || "proportional",
      orderType: (process.env.ORDER_TYPE as OrderType) || "limit",
      orderExpirationSeconds: parseInt(process.env.ORDER_EXPIRATION_SECONDS || "30"),
    });

    this.riskChecker = new RiskChecker({
      maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || "100"),
      maxTotalLoss: parseFloat(process.env.MAX_TOTAL_LOSS || "500"),
    });

    this.priceAdjuster = new PriceAdjuster(
      parseInt(process.env.PRICE_OFFSET_BPS || "50")
    );

    // Create executor based on TRADING_MODE
    this.executor = createExecutor({
      paperBalance: parseFloat(process.env.PAPER_TRADING_BALANCE || "1000"),
    });

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
  }

  /**
   * Handle a detected position change
   */
  private async handlePositionChange(change: PositionChange): Promise<void> {
    const startTime = Date.now();

    console.log("");
    console.log("=".repeat(60));
    console.log(`TRADE DETECTED: ${change.side} ${change.delta.toFixed(2)} shares`);
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
    const sizeResult = this.sizeCalculator.calculate({
      change,
      currentPrice,
      yourBalance: balance,
      yourPosition,
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

    return {
      dailyPnL: this.dailyPnL,
      totalPnL: this.totalPnL,
      balance,
      positions,
      totalShares,
    };
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    console.log("");
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║          POLYMARKET COPY TRADING BOT v1.0                 ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");
    console.log("");
    const orderConfig = this.sizeCalculator.getOrderConfig();
    console.log(`  Mode:            ${getTradingMode().toUpperCase()}`);
    console.log(`  Trader:          ${process.env.TRADER_ADDRESS?.slice(0, 10)}...`);
    console.log(`  Poll Interval:   ${process.env.POLLING_INTERVAL_MS || 1000}ms`);
    console.log(`  Sizing:          ${process.env.SIZING_METHOD || "proportional_to_portfolio"}`);
    console.log(`  Portfolio %:     ${(parseFloat(process.env.PORTFOLIO_PERCENTAGE || "0.05") * 100).toFixed(1)}%`);
    console.log(`  SELL Strategy:   ${process.env.SELL_STRATEGY || "proportional"}`);
    console.log(`  Order Type:      ${orderConfig.orderType.toUpperCase()}`);
    console.log(`  Order Expiry:    ${orderConfig.expirationSeconds > 0 ? `${orderConfig.expirationSeconds}s` : 'GTC'}`);
    console.log(`  Price Offset:    ${orderConfig.priceOffsetBps} bps (${(orderConfig.priceOffsetBps / 100).toFixed(2)}%)`);
    console.log(`  Starting Balance: $${(await this.executor.getBalance()).toFixed(2)}`);
    console.log("");

    await this.poller.start();

    console.log("Press Ctrl+C to stop");
    console.log("");
  }

  /**
   * Stop the bot
   */
  stop(): void {
    this.poller.stop();
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
