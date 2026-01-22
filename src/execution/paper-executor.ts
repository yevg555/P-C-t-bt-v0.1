/**
 * PAPER TRADING EXECUTOR
 * ======================
 * Simulates order execution without using real money.
 * Perfect for testing strategies before going live.
 *
 * Features:
 * - Simulates instant fills at specified price
 * - Tracks virtual balance and positions
 * - Records all trades for analysis
 * - Calculates P&L
 */

import {
  OrderSpec,
  OrderResult,
  OrderExecutor,
  TradingMode,
  PaperPortfolio,
  PaperPosition,
  PaperTrade,
  SpendTracker,
} from "../types";

/**
 * Configuration for paper trading
 */
export interface PaperExecutorConfig {
  /** Starting balance in USD */
  initialBalance: number;
  /** Simulate slippage (basis points, 0 = perfect fills) */
  slippageBps?: number;
  /** Simulate partial fills (0-1, 1 = always full fill) */
  fillRate?: number;
}

const DEFAULT_CONFIG: PaperExecutorConfig = {
  initialBalance: 1000,
  slippageBps: 0,
  fillRate: 1.0,
};

/**
 * Paper trading executor - simulates trades without real money
 */
export class PaperTradingExecutor implements OrderExecutor {
  private portfolio: PaperPortfolio;
  private config: PaperExecutorConfig;
  private orderCounter: number = 0;
  private spendTracker: SpendTracker;
  /** Maps tokenId to marketId for spend tracking */
  private tokenToMarket: Map<string, string> = new Map();

  constructor(config: Partial<PaperExecutorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.portfolio = {
      balance: this.config.initialBalance,
      initialBalance: this.config.initialBalance,
      positions: new Map(),
      trades: [],
      totalPnL: 0,
    };

    this.spendTracker = {
      tokenSpend: new Map(),
      marketSpend: new Map(),
      totalHoldingsValue: 0,
    };

    console.log(`[PAPER] Initialized with $${this.config.initialBalance} balance`);
  }

  /**
   * Execute a simulated order
   */
  async execute(order: OrderSpec): Promise<OrderResult> {
    const orderId = this.generateOrderId();
    const executedAt = new Date();

    // Apply simulated slippage
    const executionPrice = this.applySlippage(order.price, order.side);

    // Calculate fill size (simulate partial fills if configured)
    const fillSize = Math.floor(order.size * (this.config.fillRate ?? 1));

    if (fillSize === 0) {
      return {
        orderId,
        status: "cancelled",
        filledSize: 0,
        error: "Order size too small after fill rate applied",
        executedAt,
        executionMode: "paper",
      };
    }

    // Execute based on side
    if (order.side === "BUY") {
      return this.executeBuy(orderId, order, executionPrice, fillSize, executedAt);
    } else {
      return this.executeSell(orderId, order, executionPrice, fillSize, executedAt);
    }
  }

  /**
   * Execute a buy order
   */
  private executeBuy(
    orderId: string,
    order: OrderSpec,
    price: number,
    size: number,
    executedAt: Date
  ): OrderResult {
    const cost = size * price;

    // Check balance
    if (cost > this.portfolio.balance) {
      // Reduce size to what we can afford
      const affordableSize = Math.floor(this.portfolio.balance / price);

      if (affordableSize < 1) {
        console.log(`[PAPER] BUY REJECTED: Insufficient balance ($${this.portfolio.balance.toFixed(2)} < $${cost.toFixed(2)})`);
        return {
          orderId,
          status: "failed",
          filledSize: 0,
          error: `Insufficient balance: need $${cost.toFixed(2)}, have $${this.portfolio.balance.toFixed(2)}`,
          executedAt,
          executionMode: "paper",
        };
      }

      // Partial fill with what we can afford
      return this.executeBuy(orderId, order, price, affordableSize, executedAt);
    }

    // Deduct from balance
    this.portfolio.balance -= cost;

    // Update position
    const existing = this.portfolio.positions.get(order.tokenId);
    if (existing) {
      // Average in
      const totalQuantity = existing.quantity + size;
      const totalCost = existing.totalCost + cost;
      existing.quantity = totalQuantity;
      existing.totalCost = totalCost;
      existing.avgPrice = totalCost / totalQuantity;
    } else {
      // New position - track entry price for TP/SL
      const marketId = order.triggeredBy?.marketId;
      this.portfolio.positions.set(order.tokenId, {
        tokenId: order.tokenId,
        quantity: size,
        avgPrice: price,
        totalCost: cost,
        marketId,
        entryPrice: price,
        openedAt: new Date(),
      });
      if (marketId) {
        this.tokenToMarket.set(order.tokenId, marketId);
      }
    }

    // Update spend tracking
    const currentTokenSpend = this.spendTracker.tokenSpend.get(order.tokenId) || 0;
    this.spendTracker.tokenSpend.set(order.tokenId, currentTokenSpend + cost);

    const marketId = order.triggeredBy?.marketId || this.tokenToMarket.get(order.tokenId);
    if (marketId) {
      const currentMarketSpend = this.spendTracker.marketSpend.get(marketId) || 0;
      this.spendTracker.marketSpend.set(marketId, currentMarketSpend + cost);
    }

    // Update total holdings value
    this.updateTotalHoldingsValue();

    // Record trade
    const trade: PaperTrade = {
      orderId,
      tokenId: order.tokenId,
      side: "BUY",
      size,
      price,
      cost,
      executedAt,
    };
    this.portfolio.trades.push(trade);

    const orderType = order.orderType || "limit";
    console.log(`[PAPER] BUY FILLED (${orderType}): ${size} shares @ $${price.toFixed(4)} = $${cost.toFixed(2)}`);
    console.log(`[PAPER] Balance: $${this.portfolio.balance.toFixed(2)}`);

    return {
      orderId,
      status: "filled",
      filledSize: size,
      avgFillPrice: price,
      placedAt: executedAt,
      executedAt,
      executionMode: "paper",
      orderType,
    };
  }

  /**
   * Execute a sell order
   */
  private executeSell(
    orderId: string,
    order: OrderSpec,
    price: number,
    size: number,
    executedAt: Date
  ): OrderResult {
    const position = this.portfolio.positions.get(order.tokenId);

    if (!position || position.quantity === 0) {
      console.log(`[PAPER] SELL REJECTED: No position in ${order.tokenId.slice(0, 16)}...`);
      return {
        orderId,
        status: "failed",
        filledSize: 0,
        error: "No position to sell",
        executedAt,
        executionMode: "paper",
      };
    }

    // Cap at available quantity
    const sellSize = Math.min(size, position.quantity);
    const proceeds = sellSize * price;

    // Calculate P&L for this trade
    const costBasis = position.avgPrice * sellSize;
    const tradePnL = proceeds - costBasis;

    // Add proceeds to balance
    this.portfolio.balance += proceeds;
    this.portfolio.totalPnL += tradePnL;

    // Update position
    position.quantity -= sellSize;
    position.totalCost -= costBasis;

    if (position.quantity === 0) {
      this.portfolio.positions.delete(order.tokenId);
    }

    // Update total holdings value after sell
    this.updateTotalHoldingsValue();

    // Record trade
    const trade: PaperTrade = {
      orderId,
      tokenId: order.tokenId,
      side: "SELL",
      size: sellSize,
      price,
      cost: proceeds,
      executedAt,
    };
    this.portfolio.trades.push(trade);

    const orderType = order.orderType || "limit";
    const pnlSign = tradePnL >= 0 ? "+" : "";
    console.log(`[PAPER] SELL FILLED (${orderType}): ${sellSize} shares @ $${price.toFixed(4)} = $${proceeds.toFixed(2)} (${pnlSign}$${tradePnL.toFixed(2)})`);
    console.log(`[PAPER] Balance: $${this.portfolio.balance.toFixed(2)} | Total P&L: ${pnlSign}$${this.portfolio.totalPnL.toFixed(2)}`);

    return {
      orderId,
      status: "filled",
      filledSize: sellSize,
      avgFillPrice: price,
      placedAt: executedAt,
      executedAt,
      executionMode: "paper",
      orderType,
    };
  }

  /**
   * Apply simulated slippage to price
   */
  private applySlippage(price: number, side: "BUY" | "SELL"): number {
    if (!this.config.slippageBps || this.config.slippageBps === 0) {
      return price;
    }

    const slippageMultiplier = this.config.slippageBps / 10000;

    // BUY = pay more, SELL = receive less
    if (side === "BUY") {
      return price * (1 + slippageMultiplier);
    } else {
      return price * (1 - slippageMultiplier);
    }
  }

  /**
   * Generate a unique order ID
   */
  private generateOrderId(): string {
    this.orderCounter++;
    return `PAPER-${Date.now()}-${this.orderCounter}`;
  }

  /**
   * Get current balance
   */
  async getBalance(): Promise<number> {
    return this.portfolio.balance;
  }

  /**
   * Get position size for a token
   */
  async getPosition(tokenId: string): Promise<number> {
    const position = this.portfolio.positions.get(tokenId);
    return position?.quantity ?? 0;
  }

  /**
   * Get all positions
   */
  async getAllPositions(): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    for (const [tokenId, position] of this.portfolio.positions) {
      result.set(tokenId, position.quantity);
    }
    return result;
  }

  /**
   * Get trading mode
   */
  getMode(): TradingMode {
    return "paper";
  }

  /**
   * Paper executor is always ready
   */
  async isReady(): Promise<boolean> {
    return true;
  }

  // === Additional methods for paper trading ===

  /**
   * Get full portfolio state
   */
  getPortfolio(): PaperPortfolio {
    return { ...this.portfolio };
  }

  /**
   * Get all trades
   */
  getTrades(): PaperTrade[] {
    return [...this.portfolio.trades];
  }

  /**
   * Get detailed position info
   */
  getPositionDetails(tokenId: string): PaperPosition | undefined {
    return this.portfolio.positions.get(tokenId);
  }

  /**
   * Get total P&L
   */
  getTotalPnL(): number {
    return this.portfolio.totalPnL;
  }

  /**
   * Get unrealized P&L (requires current prices)
   */
  getUnrealizedPnL(currentPrices: Map<string, number>): number {
    let unrealizedPnL = 0;

    for (const [tokenId, position] of this.portfolio.positions) {
      const currentPrice = currentPrices.get(tokenId);
      if (currentPrice !== undefined) {
        const currentValue = position.quantity * currentPrice;
        const costBasis = position.totalCost;
        unrealizedPnL += currentValue - costBasis;
      }
    }

    return unrealizedPnL;
  }

  /**
   * Get summary stats
   */
  getSummary(): {
    balance: number;
    initialBalance: number;
    totalPnL: number;
    tradeCount: number;
    positionCount: number;
    winRate: number;
  } {
    // Calculate win rate from completed round-trips
    const sellTrades = this.portfolio.trades.filter((t) => t.side === "SELL");
    const winningTrades = sellTrades.filter((t, i) => {
      // Simple approximation - compare to avg cost
      const position = this.portfolio.positions.get(t.tokenId);
      if (!position) return t.price > 0; // Position closed, can't determine
      return t.price > position.avgPrice;
    });

    const winRate = sellTrades.length > 0 ? winningTrades.length / sellTrades.length : 0;

    return {
      balance: this.portfolio.balance,
      initialBalance: this.portfolio.initialBalance,
      totalPnL: this.portfolio.totalPnL,
      tradeCount: this.portfolio.trades.length,
      positionCount: this.portfolio.positions.size,
      winRate,
    };
  }

  /**
   * Reset the paper trading state
   */
  reset(): void {
    this.portfolio = {
      balance: this.config.initialBalance,
      initialBalance: this.config.initialBalance,
      positions: new Map(),
      trades: [],
      totalPnL: 0,
    };
    this.spendTracker = {
      tokenSpend: new Map(),
      marketSpend: new Map(),
      totalHoldingsValue: 0,
    };
    this.tokenToMarket.clear();
    this.orderCounter = 0;
    console.log(`[PAPER] Reset to $${this.config.initialBalance} balance`);
  }

  /**
   * Update total holdings value based on current positions
   */
  private updateTotalHoldingsValue(): void {
    let total = 0;
    for (const position of this.portfolio.positions.values()) {
      total += position.totalCost;
    }
    this.spendTracker.totalHoldingsValue = total;
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
   * Get all position details (for TP/SL monitoring)
   */
  async getAllPositionDetails(): Promise<Map<string, PaperPosition>> {
    return new Map(this.portfolio.positions);
  }

  /**
   * Get token spend for a specific token
   */
  getTokenSpend(tokenId: string): number {
    return this.spendTracker.tokenSpend.get(tokenId) || 0;
  }

  /**
   * Get market spend for a specific market
   */
  getMarketSpend(marketId: string): number {
    return this.spendTracker.marketSpend.get(marketId) || 0;
  }

  /**
   * Sell all positions immediately (1-Click Sell / Kill Switch)
   */
  async sellAllPositions(currentPrices: Map<string, number>): Promise<OrderResult[]> {
    const results: OrderResult[] = [];
    const positions = Array.from(this.portfolio.positions.entries());

    if (positions.length === 0) {
      console.log("[PAPER] No positions to sell");
      return results;
    }

    console.log(`\n${"!".repeat(50)}`);
    console.log("!!! 1-CLICK SELL ACTIVATED - SELLING ALL POSITIONS !!!");
    console.log(`${"!".repeat(50)}\n`);

    for (const [tokenId, position] of positions) {
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
        console.error(`[PAPER] Failed to sell ${tokenId}: ${error}`);
        results.push({
          orderId: `FAILED-${tokenId}`,
          status: "failed",
          filledSize: 0,
          error: String(error),
          executedAt: new Date(),
          executionMode: "paper",
        });
      }
    }

    console.log(`\n[PAPER] 1-Click Sell Complete: ${results.filter(r => r.status === "filled").length}/${positions.length} positions closed\n`);
    return results;
  }

  /**
   * Set token to market mapping (for spend tracking)
   */
  setTokenMarket(tokenId: string, marketId: string): void {
    this.tokenToMarket.set(tokenId, marketId);
  }
}
