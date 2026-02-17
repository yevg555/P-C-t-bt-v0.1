/**
 * DASHBOARD SERVER
 * ================
 * Express REST API + WebSocket server for the copy trading bot dashboard.
 *
 * REST endpoints:
 *   GET /                     - HTML dashboard
 *   GET /api/stats            - Current bot stats (poller, P&L, latency)
 *   GET /api/positions        - Open positions with details
 *   GET /api/trades?limit=N&offset=N&side=BUY|SELL - Trade history
 *   GET /api/sessions?limit=N - Session history
 *   GET /api/performance      - Aggregate performance summary
 *   GET /api/performance/tokens - P&L grouped by token
 *   GET /api/analytics         - Advanced analytics (Sharpe, drawdown, etc.)
 *   GET /api/config           - Current bot configuration
 *
 * WebSocket (same port):
 *   Broadcasts JSON messages on events:
 *     { type: "stats",    data: {...} }  - every 2s
 *     { type: "trade",    data: {...} }  - on new trade
 *     { type: "positions", data: {...} } - every 5s
 */

import express from "express";
import { createServer, Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as path from "path";
import * as fs from "fs";
import { TradeStore, TradeQuery } from "../storage";
import { OrderExecutor } from "../types";

// The bot interface we need — keeps dashboard decoupled from the full bot class
export interface DashboardBotInterface {
  getStats(): {
    pollerStats: Record<string, unknown>;
    tradeCount: number;
    totalPnL: number;
    dailyPnL: number;
    mode: string;
    pollingMethod: string;
    latencyStats: {
      avgDetectionMs: number;
      avgExecutionMs: number;
      avgTotalMs: number;
      sampleCount: number;
      clockDriftOffset: number;
    };
  };
  getExecutor(): OrderExecutor;
  getTradeStore(): TradeStore;
}

export class DashboardServer {
  private app: express.Application;
  private httpServer: HttpServer;
  private wss: WebSocketServer;
  private bot: DashboardBotInterface;
  private statsInterval: NodeJS.Timeout | null = null;
  private positionsInterval: NodeJS.Timeout | null = null;
  private port: number;

  constructor(bot: DashboardBotInterface, port: number = 3456) {
    this.bot = bot;
    this.port = port;

    this.app = express();
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupRoutes(): void {
    // Serve the dashboard HTML
    this.app.get("/", (_req, res) => {
      const htmlPath = path.join(__dirname, "index.html");
      if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
      } else {
        // Fallback: try the source directory (when running with ts-node)
        const srcHtmlPath = path.resolve(__dirname, "index.html");
        res.sendFile(srcHtmlPath);
      }
    });

    // Current bot stats
    this.app.get("/api/stats", async (_req, res) => {
      try {
        const stats = this.bot.getStats();
        const executor = this.bot.getExecutor();
        const balance = await executor.getBalance();
        res.json({ ...stats, balance });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Open positions
    this.app.get("/api/positions", async (_req, res) => {
      try {
        const executor = this.bot.getExecutor();
        const positions: Array<Record<string, unknown>> = [];

        if (executor.getAllPositionDetails) {
          const details = await executor.getAllPositionDetails();
          for (const [tokenId, pos] of details) {
            positions.push({
              tokenId,
              quantity: pos.quantity,
              avgPrice: pos.avgPrice,
              totalCost: pos.totalCost,
              entryPrice: pos.entryPrice,
              marketId: pos.marketId,
              openedAt: pos.openedAt?.toISOString() || null,
            });
          }
        }

        res.json({ positions });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Trade history
    this.app.get("/api/trades", (req, res) => {
      try {
        const store = this.bot.getTradeStore();
        const query: TradeQuery = {
          limit: req.query.limit ? Number(req.query.limit) : 100,
          offset: req.query.offset ? Number(req.query.offset) : 0,
        };
        if (req.query.side === "BUY" || req.query.side === "SELL") {
          query.side = req.query.side;
        }
        if (typeof req.query.tokenId === "string") {
          query.tokenId = req.query.tokenId;
        }
        if (typeof req.query.sessionId === "string") {
          query.sessionId = Number(req.query.sessionId);
        }
        const trades = store.getTrades(query);
        const total = store.getTradeCount(
          query.sessionId ? query.sessionId : undefined
        );
        res.json({ trades, total });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Session history
    this.app.get("/api/sessions", (req, res) => {
      try {
        const store = this.bot.getTradeStore();
        const limit = req.query.limit ? Number(req.query.limit) : 20;
        const sessions = store.getSessions(limit);
        res.json({ sessions });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Performance summary
    this.app.get("/api/performance", (req, res) => {
      try {
        const store = this.bot.getTradeStore();
        const sessionId = req.query.sessionId
          ? Number(req.query.sessionId)
          : undefined;
        const summary = store.getPerformanceSummary(sessionId);
        res.json(summary);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // P&L by token
    this.app.get("/api/performance/tokens", (req, res) => {
      try {
        const store = this.bot.getTradeStore();
        const sessionId = req.query.sessionId
          ? Number(req.query.sessionId)
          : undefined;
        const tokenPnl = store.getPnlByToken(sessionId);
        res.json({ tokens: tokenPnl });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Advanced analytics (Sharpe ratio, drawdown, profit factor, etc.)
    this.app.get("/api/analytics", (req, res) => {
      try {
        const store = this.bot.getTradeStore();
        const sessionId = req.query.sessionId
          ? Number(req.query.sessionId)
          : undefined;
        const analytics = store.getAdvancedAnalytics(sessionId);
        res.json(analytics);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // Bot configuration
    this.app.get("/api/config", async (_req, res) => {
      try {
        const executor = this.bot.getExecutor();
        const spend = executor.getSpendTracker?.() || {
          tokenSpend: new Map(),
          marketSpend: new Map(),
          totalHoldingsValue: 0,
        };
        res.json({
          mode: executor.getMode(),
          spendTracker: {
            tokenSpend: Object.fromEntries(spend.tokenSpend),
            marketSpend: Object.fromEntries(spend.marketSpend),
            totalHoldingsValue: spend.totalHoldingsValue,
          },
        });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });
  }

  private setupWebSocket(): void {
    this.wss.on("connection", (ws) => {
      // Send initial state immediately on connect
      this.sendStatsToClient(ws);
      this.sendPositionsToClient(ws);
    });
  }

  private async sendStatsToClient(ws: WebSocket): Promise<void> {
    try {
      const stats = this.bot.getStats();
      const balance = await this.bot.getExecutor().getBalance();
      ws.send(JSON.stringify({ type: "stats", data: { ...stats, balance } }));
    } catch {
      // Ignore send errors
    }
  }

  private async sendPositionsToClient(ws: WebSocket): Promise<void> {
    try {
      const executor = this.bot.getExecutor();
      if (!executor.getAllPositionDetails) return;

      const details = await executor.getAllPositionDetails();
      const positions: Array<Record<string, unknown>> = [];
      for (const [tokenId, pos] of details) {
        positions.push({
          tokenId,
          quantity: pos.quantity,
          avgPrice: pos.avgPrice,
          totalCost: pos.totalCost,
          entryPrice: pos.entryPrice,
          marketId: pos.marketId,
          openedAt: pos.openedAt?.toISOString() || null,
        });
      }
      ws.send(JSON.stringify({ type: "positions", data: { positions } }));
    } catch {
      // Ignore send errors
    }
  }

  private broadcast(message: string): void {
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /** Call this from the bot when a trade is recorded */
  notifyTrade(trade: Record<string, unknown>): void {
    this.broadcast(JSON.stringify({ type: "trade", data: trade }));
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.port, () => {
        console.log(`[DASHBOARD] Running at http://localhost:${this.port}`);
        resolve();
      });
    });

    // Periodic stats broadcast (every 2s)
    this.statsInterval = setInterval(async () => {
      try {
        const stats = this.bot.getStats();
        const balance = await this.bot.getExecutor().getBalance();
        this.broadcast(
          JSON.stringify({ type: "stats", data: { ...stats, balance } })
        );
      } catch {
        // Ignore broadcast errors
      }
    }, 2000);

    // Periodic positions broadcast (every 5s)
    this.positionsInterval = setInterval(async () => {
      try {
        const executor = this.bot.getExecutor();
        if (!executor.getAllPositionDetails) return;

        const details = await executor.getAllPositionDetails();
        const positions: Array<Record<string, unknown>> = [];
        for (const [tokenId, pos] of details) {
          positions.push({
            tokenId,
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            totalCost: pos.totalCost,
            entryPrice: pos.entryPrice,
            marketId: pos.marketId,
            openedAt: pos.openedAt?.toISOString() || null,
          });
        }
        this.broadcast(
          JSON.stringify({ type: "positions", data: { positions } })
        );
      } catch {
        // Ignore broadcast errors
      }
    }, 5000);
  }

  stop(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    if (this.positionsInterval) {
      clearInterval(this.positionsInterval);
      this.positionsInterval = null;
    }
    this.wss.close();
    this.httpServer.close();
  }
}
