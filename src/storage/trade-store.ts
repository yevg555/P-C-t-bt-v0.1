/**
 * TRADE STORE
 * ===========
 * Persists trade history, sessions, and performance analytics to a local SQLite database.
 * Zero-config: creates the database file automatically on first run.
 *
 * Tables:
 * - trades: every executed order (BUY/SELL, paper/live)
 * - sessions: bot session start/stop with summary stats
 *
 * @example
 * const store = new TradeStore();  // creates ./data/trades.db
 * store.recordTrade({ ... });
 * const history = store.getTrades({ limit: 50 });
 * store.close();
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { OrderSpec, OrderResult, TradingMode } from "../types";

// ============================================
// TYPES
// ============================================

export interface TradeRecord {
  id?: number;
  orderId: string;
  sessionId: number;
  tokenId: string;
  marketId?: string;
  marketTitle?: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  cost: number;
  status: string;
  executionMode: TradingMode;
  orderType?: string;
  pnl?: number;
  detectionLatencyMs?: number;
  executionLatencyMs?: number;
  totalLatencyMs?: number;
  traderAddress?: string;
  traderPrice?: number;
  createdAt: string;
}

export interface SessionRecord {
  id?: number;
  startedAt: string;
  endedAt?: string;
  tradingMode: TradingMode;
  pollingMethod: string;
  traderAddress: string;
  pollsCompleted: number;
  tradesDetected: number;
  tradesExecuted: number;
  totalPnl: number;
  startingBalance: number;
  endingBalance?: number;
}

export interface TradeQuery {
  limit?: number;
  offset?: number;
  side?: "BUY" | "SELL";
  tokenId?: string;
  sessionId?: number;
  since?: string;
}

export interface PerformanceSummary {
  totalTrades: number;
  buyCount: number;
  sellCount: number;
  totalVolume: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgTradeSize: number;
  avgLatencyMs: number;
  bestTradePnl: number;
  worstTradePnl: number;
}

export interface AdvancedAnalytics {
  /** Annualized Sharpe ratio (assuming 365 trading days, risk-free rate = 0) */
  sharpeRatio: number;
  /** Maximum drawdown in dollar terms */
  maxDrawdownDollar: number;
  /** Maximum drawdown as a percentage (0-1) */
  maxDrawdownPercent: number;
  /** Gross profits divided by gross losses (Infinity if no losses) */
  profitFactor: number;
  /** Average P&L of winning trades */
  averageWin: number;
  /** Average P&L of losing trades (negative number) */
  averageLoss: number;
  /** Longest consecutive winning streak */
  largestWinStreak: number;
  /** Longest consecutive losing streak */
  largestLossStreak: number;
  /** Expectancy per trade: (winRate * avgWin) - (lossRate * avgLoss) */
  expectancy: number;
  /** Number of trades included in the analysis */
  tradeCount: number;
}

// ============================================
// TRADE STORE
// ============================================

export class TradeStore {
  private db: Database.Database;
  private currentSessionId: number = 0;

  // Prepared statements for performance
  private insertTradeStmt: Database.Statement;
  private insertSessionStmt: Database.Statement;
  private updateSessionStmt: Database.Statement;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath || path.join(process.cwd(), "data", "trades.db");

    // Ensure directory exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);

    // Enable WAL mode for better concurrent read/write performance
    this.db.pragma("journal_mode = WAL");

    this.createTables();

    // Prepare statements
    this.insertTradeStmt = this.db.prepare(`
      INSERT INTO trades (
        order_id, session_id, token_id, market_id, market_title,
        side, size, price, cost, status,
        execution_mode, order_type, pnl,
        detection_latency_ms, execution_latency_ms, total_latency_ms,
        trader_address, trader_price, created_at
      ) VALUES (
        @orderId, @sessionId, @tokenId, @marketId, @marketTitle,
        @side, @size, @price, @cost, @status,
        @executionMode, @orderType, @pnl,
        @detectionLatencyMs, @executionLatencyMs, @totalLatencyMs,
        @traderAddress, @traderPrice, @createdAt
      )
    `);

    this.insertSessionStmt = this.db.prepare(`
      INSERT INTO sessions (
        started_at, trading_mode, polling_method, trader_address,
        polls_completed, trades_detected, trades_executed,
        total_pnl, starting_balance
      ) VALUES (
        @startedAt, @tradingMode, @pollingMethod, @traderAddress,
        0, 0, 0, 0, @startingBalance
      )
    `);

    this.updateSessionStmt = this.db.prepare(`
      UPDATE sessions SET
        ended_at = @endedAt,
        polls_completed = @pollsCompleted,
        trades_detected = @tradesDetected,
        trades_executed = @tradesExecuted,
        total_pnl = @totalPnl,
        ending_balance = @endingBalance
      WHERE id = @id
    `);
  }

  /**
   * Create database tables if they don't exist
   */
  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        session_id INTEGER NOT NULL,
        token_id TEXT NOT NULL,
        market_id TEXT,
        market_title TEXT,
        side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
        size REAL NOT NULL,
        price REAL NOT NULL,
        cost REAL NOT NULL,
        status TEXT NOT NULL,
        execution_mode TEXT NOT NULL,
        order_type TEXT,
        pnl REAL,
        detection_latency_ms INTEGER,
        execution_latency_ms INTEGER,
        total_latency_ms INTEGER,
        trader_address TEXT,
        trader_price REAL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_trades_session ON trades(session_id);
      CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token_id);
      CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);
      CREATE INDEX IF NOT EXISTS idx_trades_side ON trades(side);

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        trading_mode TEXT NOT NULL,
        polling_method TEXT NOT NULL,
        trader_address TEXT NOT NULL,
        polls_completed INTEGER DEFAULT 0,
        trades_detected INTEGER DEFAULT 0,
        trades_executed INTEGER DEFAULT 0,
        total_pnl REAL DEFAULT 0,
        starting_balance REAL DEFAULT 0,
        ending_balance REAL
      );
    `);
  }

  // ============================================
  // SESSION MANAGEMENT
  // ============================================

  /**
   * Start a new session and return its ID
   */
  startSession(config: {
    tradingMode: TradingMode;
    pollingMethod: string;
    traderAddress: string;
    startingBalance: number;
  }): number {
    const result = this.insertSessionStmt.run({
      startedAt: new Date().toISOString(),
      tradingMode: config.tradingMode,
      pollingMethod: config.pollingMethod,
      traderAddress: config.traderAddress,
      startingBalance: config.startingBalance,
    });

    this.currentSessionId = result.lastInsertRowid as number;
    return this.currentSessionId;
  }

  /**
   * End the current session with final stats
   */
  endSession(stats: {
    pollsCompleted: number;
    tradesDetected: number;
    tradesExecuted: number;
    totalPnl: number;
    endingBalance: number;
  }): void {
    if (this.currentSessionId === 0) return;

    this.updateSessionStmt.run({
      id: this.currentSessionId,
      endedAt: new Date().toISOString(),
      pollsCompleted: stats.pollsCompleted,
      tradesDetected: stats.tradesDetected,
      tradesExecuted: stats.tradesExecuted,
      totalPnl: stats.totalPnl,
      endingBalance: stats.endingBalance,
    });
  }

  /**
   * Get the current session ID
   */
  getSessionId(): number {
    return this.currentSessionId;
  }

  // ============================================
  // TRADE RECORDING
  // ============================================

  /**
   * Record a completed trade
   */
  recordTrade(params: {
    order: OrderSpec;
    result: OrderResult;
    traderAddress?: string;
    traderPrice?: number;
    pnl?: number;
    detectionLatencyMs?: number;
    executionLatencyMs?: number;
    totalLatencyMs?: number;
  }): number {
    const { order, result } = params;
    const cost = result.filledSize * (result.avgFillPrice || order.price);

    const info = this.insertTradeStmt.run({
      orderId: result.orderId,
      sessionId: this.currentSessionId,
      tokenId: order.tokenId,
      marketId: order.triggeredBy?.marketId || null,
      marketTitle: order.triggeredBy?.marketTitle || null,
      side: order.side,
      size: result.filledSize,
      price: result.avgFillPrice || order.price,
      cost,
      status: result.status,
      executionMode: result.executionMode,
      orderType: result.orderType || order.orderType || null,
      pnl: params.pnl ?? null,
      detectionLatencyMs: params.detectionLatencyMs || null,
      executionLatencyMs: params.executionLatencyMs || null,
      totalLatencyMs: params.totalLatencyMs || null,
      traderAddress: params.traderAddress || null,
      traderPrice: params.traderPrice || null,
      createdAt: result.executedAt.toISOString(),
    });

    return info.lastInsertRowid as number;
  }

  /**
   * Update the P&L for a trade (typically after a sell completes)
   */
  updateTradePnl(tradeId: number, pnl: number): void {
    this.db.prepare("UPDATE trades SET pnl = ? WHERE id = ?").run(pnl, tradeId);
  }

  // ============================================
  // QUERYING
  // ============================================

  /**
   * Get trades with optional filtering
   */
  getTrades(query: TradeQuery = {}): TradeRecord[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.side) {
      conditions.push("side = @side");
      params.side = query.side;
    }
    if (query.tokenId) {
      conditions.push("token_id = @tokenId");
      params.tokenId = query.tokenId;
    }
    if (query.sessionId) {
      conditions.push("session_id = @sessionId");
      params.sessionId = query.sessionId;
    }
    if (query.since) {
      conditions.push("created_at >= @since");
      params.since = query.since;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = query.limit || 100;
    const offset = query.offset || 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM trades ${where} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`
      )
      .all({ ...params, limit, offset }) as Array<Record<string, unknown>>;

    return rows.map(this.mapTradeRow);
  }

  /**
   * Get all sessions
   */
  getSessions(limit: number = 20): SessionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as number,
      startedAt: row.started_at as string,
      endedAt: row.ended_at as string | undefined,
      tradingMode: row.trading_mode as TradingMode,
      pollingMethod: row.polling_method as string,
      traderAddress: row.trader_address as string,
      pollsCompleted: row.polls_completed as number,
      tradesDetected: row.trades_detected as number,
      tradesExecuted: row.trades_executed as number,
      totalPnl: row.total_pnl as number,
      startingBalance: row.starting_balance as number,
      endingBalance: row.ending_balance as number | undefined,
    }));
  }

  /**
   * Get performance summary across all trades or for a specific session
   */
  getPerformanceSummary(sessionId?: number): PerformanceSummary {
    const where = sessionId ? "WHERE session_id = ?" : "";
    const params = sessionId ? [sessionId] : [];

    const stats = this.db
      .prepare(
        `SELECT
          COUNT(*) as total_trades,
          SUM(CASE WHEN side = 'BUY' THEN 1 ELSE 0 END) as buy_count,
          SUM(CASE WHEN side = 'SELL' THEN 1 ELSE 0 END) as sell_count,
          SUM(cost) as total_volume,
          COALESCE(SUM(pnl), 0) as total_pnl,
          SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as win_count,
          SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as loss_count,
          AVG(size) as avg_trade_size,
          AVG(total_latency_ms) as avg_latency_ms,
          MAX(pnl) as best_trade_pnl,
          MIN(pnl) as worst_trade_pnl
        FROM trades ${where}`
      )
      .get(...params) as Record<string, unknown>;

    const totalTrades = (stats.total_trades as number) || 0;
    const winCount = (stats.win_count as number) || 0;
    const lossCount = (stats.loss_count as number) || 0;
    const sellCount = winCount + lossCount;

    return {
      totalTrades,
      buyCount: (stats.buy_count as number) || 0,
      sellCount: (stats.sell_count as number) || 0,
      totalVolume: (stats.total_volume as number) || 0,
      totalPnl: (stats.total_pnl as number) || 0,
      winCount,
      lossCount,
      winRate: sellCount > 0 ? winCount / sellCount : 0,
      avgTradeSize: (stats.avg_trade_size as number) || 0,
      avgLatencyMs: (stats.avg_latency_ms as number) || 0,
      bestTradePnl: (stats.best_trade_pnl as number) || 0,
      worstTradePnl: (stats.worst_trade_pnl as number) || 0,
    };
  }

  /**
   * Get P&L grouped by token
   */
  getPnlByToken(sessionId?: number): Array<{ tokenId: string; marketTitle: string | null; pnl: number; tradeCount: number }> {
    const where = sessionId ? "WHERE session_id = ?" : "";
    const params = sessionId ? [sessionId] : [];

    return this.db
      .prepare(
        `SELECT
          token_id as tokenId,
          MAX(market_title) as marketTitle,
          COALESCE(SUM(pnl), 0) as pnl,
          COUNT(*) as tradeCount
        FROM trades ${where}
        GROUP BY token_id
        ORDER BY pnl DESC`
      )
      .all(...params) as Array<{ tokenId: string; marketTitle: string | null; pnl: number; tradeCount: number }>;
  }

  /**
   * Get total trade count
   */
  getTradeCount(sessionId?: number): number {
    const where = sessionId ? "WHERE session_id = ?" : "";
    const params = sessionId ? [sessionId] : [];

    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM trades ${where}`)
      .get(...params) as { count: number };

    return result.count;
  }

  // ============================================
  // ADVANCED ANALYTICS
  // ============================================

  /**
   * Compute advanced performance analytics from SELL trades with realized P&L.
   *
   * Metrics:
   *   - Sharpe Ratio (annualized, 365 days, risk-free rate = 0)
   *   - Max Drawdown (dollar and percentage)
   *   - Profit Factor (gross profits / gross losses)
   *   - Average Win / Average Loss
   *   - Largest Win Streak / Loss Streak
   *   - Expectancy per trade
   */
  getAdvancedAnalytics(sessionId?: number): AdvancedAnalytics {
    const where = sessionId
      ? "WHERE side = 'SELL' AND pnl IS NOT NULL AND session_id = ?"
      : "WHERE side = 'SELL' AND pnl IS NOT NULL";
    const params = sessionId ? [sessionId] : [];

    const rows = this.db
      .prepare(
        `SELECT pnl FROM trades ${where} ORDER BY created_at ASC`
      )
      .all(...params) as Array<{ pnl: number }>;

    const tradeCount = rows.length;

    // Default / empty result when there are no qualifying trades
    if (tradeCount === 0) {
      return {
        sharpeRatio: 0,
        maxDrawdownDollar: 0,
        maxDrawdownPercent: 0,
        profitFactor: 0,
        averageWin: 0,
        averageLoss: 0,
        largestWinStreak: 0,
        largestLossStreak: 0,
        expectancy: 0,
        tradeCount: 0,
      };
    }

    const pnls = rows.map((r) => r.pnl);

    // ----- Win / Loss buckets -----
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);

    const grossProfit = wins.reduce((s, p) => s + p, 0);
    const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));

    const averageWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const averageLoss = losses.length > 0 ? -(grossLoss / losses.length) : 0;

    const winRate = wins.length / tradeCount;
    const lossRate = losses.length / tradeCount;

    // ----- Profit Factor -----
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

    // ----- Expectancy -----
    // expectancy = (winRate * avgWin) - (lossRate * |avgLoss|)
    const expectancy = (winRate * averageWin) - (lossRate * Math.abs(averageLoss));

    // ----- Sharpe Ratio (annualized) -----
    const meanPnl = pnls.reduce((s, p) => s + p, 0) / tradeCount;
    let variance = 0;
    for (const p of pnls) {
      variance += (p - meanPnl) ** 2;
    }
    variance = tradeCount > 1 ? variance / (tradeCount - 1) : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (meanPnl / stdDev) * Math.sqrt(365) : 0;

    // ----- Max Drawdown -----
    let peak = 0;
    let cumulative = 0;
    let maxDrawdownDollar = 0;
    let maxDrawdownPercent = 0;

    for (const p of pnls) {
      cumulative += p;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdownDollar) {
        maxDrawdownDollar = drawdown;
        maxDrawdownPercent = peak > 0 ? drawdown / peak : 0;
      }
    }

    // ----- Win / Loss Streaks -----
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    let largestWinStreak = 0;
    let largestLossStreak = 0;

    for (const p of pnls) {
      if (p > 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        if (currentWinStreak > largestWinStreak) {
          largestWinStreak = currentWinStreak;
        }
      } else if (p < 0) {
        currentLossStreak++;
        currentWinStreak = 0;
        if (currentLossStreak > largestLossStreak) {
          largestLossStreak = currentLossStreak;
        }
      } else {
        // p === 0 (breakeven) resets both streaks
        currentWinStreak = 0;
        currentLossStreak = 0;
      }
    }

    return {
      sharpeRatio,
      maxDrawdownDollar,
      maxDrawdownPercent,
      profitFactor,
      averageWin,
      averageLoss,
      largestWinStreak,
      largestLossStreak,
      expectancy,
      tradeCount,
    };
  }

  // ============================================
  // CLEANUP
  // ============================================

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  // ============================================
  // HELPERS
  // ============================================

  private mapTradeRow(row: Record<string, unknown>): TradeRecord {
    return {
      id: row.id as number,
      orderId: row.order_id as string,
      sessionId: row.session_id as number,
      tokenId: row.token_id as string,
      marketId: row.market_id as string | undefined,
      marketTitle: row.market_title as string | undefined,
      side: row.side as "BUY" | "SELL",
      size: row.size as number,
      price: row.price as number,
      cost: row.cost as number,
      status: row.status as string,
      executionMode: row.execution_mode as TradingMode,
      orderType: row.order_type as string | undefined,
      pnl: row.pnl as number | undefined,
      detectionLatencyMs: row.detection_latency_ms as number | undefined,
      executionLatencyMs: row.execution_latency_ms as number | undefined,
      totalLatencyMs: row.total_latency_ms as number | undefined,
      traderAddress: row.trader_address as string | undefined,
      traderPrice: row.trader_price as number | undefined,
      createdAt: row.created_at as string,
    };
  }
}
