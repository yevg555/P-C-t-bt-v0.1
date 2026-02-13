/**
 * ACTIVITY POLLER
 * ================
 * Polls the /activity endpoint for trader's actual trades.
 *
 * Why use this instead of position polling?
 * - Exact trade timestamps → accurate latency measurement
 * - Exact execution prices → better copy accuracy
 * - Incremental fetching with `after` parameter → more efficient
 * - Event-driven (actual trades) vs state-based (position diffs)
 *
 * @example
 * const poller = new ActivityPoller({ traderAddress: '0x...', intervalMs: 200 });
 *
 * poller.on('trade', (trade, latency) => {
 *   console.log(`Trader ${trade.side} ${trade.size} shares! (latency: ${latency}ms)`);
 *   // Copy the trade!
 * });
 *
 * await poller.start();
 */

import { EventEmitter } from 'eventemitter3';
import { PolymarketAPI, Trade } from '../api/polymarket-api';
import { PollerConfig } from '../types';

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

/**
 * Events emitted by the ActivityPoller
 */
export interface ActivityPollerEvents {
  /** A new trade was detected - this is what you care about! */
  trade: (event: TradeEvent) => void;

  /** Each poll completed (with array of new trades) */
  poll: (trades: Trade[], pollLatencyMs: number) => void;

  /** An error occurred during polling */
  error: (error: Error) => void;

  /** Poller started */
  start: () => void;

  /** Poller stopped */
  stop: () => void;

  /** Multiple consecutive errors - degraded state */
  degraded: (errorCount: number) => void;

  /** Recovered from degraded state */
  recovered: () => void;
}

/**
 * Latency statistics
 */
export interface LatencyStats {
  /** Average detection latency (ms) */
  avgDetectionLatencyMs: number;
  /** Minimum detection latency (ms) */
  minDetectionLatencyMs: number;
  /** Maximum detection latency (ms) */
  maxDetectionLatencyMs: number;
  /** Number of trades measured */
  sampleCount: number;
}

export class ActivityPoller extends EventEmitter<ActivityPollerEvents> {
  // Dependencies
  private api: PolymarketAPI;

  // Configuration
  private config: PollerConfig;

  // State
  private isRunning = false;
  private isPaused = false;
  private shouldStop = false;
  private consecutiveErrors = 0;
  private pollCount = 0;
  private tradesDetected = 0;
  private lastPollTime: Date | null = null;

  // Incremental fetching state
  private lastTradeTimestamp: number | null = null;
  private seenTradeIds: Set<string> = new Set();

  // Latency tracking
  private latencySamples: number[] = [];
  private maxLatencySamples = 100;

  constructor(config: PollerConfig, api?: PolymarketAPI) {
    super();

    this.config = {
      ...config,
      maxConsecutiveErrors: config.maxConsecutiveErrors || 5,
    };

    this.api = api || new PolymarketAPI();
  }

  /**
   * Start the polling loop
   * Uses a tight loop instead of setInterval to eliminate wasted time.
   * setInterval doesn't account for poll duration — if a poll takes 80ms
   * and interval is 200ms, setInterval still waits 200ms after the poll starts,
   * not after it ends. The tight loop waits only the remaining time.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[ActivityPoller] Already running');
      return;
    }

    console.log('\n' + '='.repeat(50));
    console.log('[ActivityPoller] 🚀 Starting Activity Poller');
    console.log('='.repeat(50));
    console.log(`  Trader:   ${this.config.traderAddress}`);
    console.log(`  Interval: ${this.config.intervalMs}ms`);
    console.log(`  Max Errors: ${this.config.maxConsecutiveErrors}`);
    console.log('='.repeat(50) + '\n');

    this.isRunning = true;
    this.shouldStop = false;
    this.emit('start');

    // Do first poll immediately (initialize baseline)
    await this.poll(true);

    console.log('[ActivityPoller] ✅ Polling started\n');

    // Tight poll loop: sleep only the remaining time after each poll completes
    this.runPollLoop();
  }

  /**
   * Tight poll loop — accounts for poll duration so we never waste time
   */
  private async runPollLoop(): Promise<void> {
    while (!this.shouldStop) {
      const pollStart = Date.now();

      if (!this.isPaused) {
        try {
          await this.poll(false);
        } catch (err) {
          console.error('[ActivityPoller] Unhandled error:', err);
        }
      }

      // Sleep only the remaining interval (subtract time the poll took)
      const elapsed = Date.now() - pollStart;
      const sleepTime = Math.max(0, this.config.intervalMs - elapsed);
      if (sleepTime > 0) {
        await new Promise(resolve => setTimeout(resolve, sleepTime));
      }
    }
  }

  /**
   * Stop the polling loop
   */
  stop(): void {
    if (!this.isRunning) {
      console.log('[ActivityPoller] Not running');
      return;
    }

    this.shouldStop = true;
    this.isRunning = false;
    this.emit('stop');

    console.log('\n[ActivityPoller] ⏹️ Stopped');
    console.log(`  Total polls: ${this.pollCount}`);
    console.log(`  Trades detected: ${this.tradesDetected}`);
    this.logLatencyStats();
  }

  /**
   * Temporarily pause polling (without stopping)
   */
  pause(): void {
    this.isPaused = true;
    console.log('[ActivityPoller] ⏸️ Paused');
  }

  /**
   * Resume after pause
   */
  resume(): void {
    this.isPaused = false;
    console.log('[ActivityPoller] ▶️ Resumed');
  }

  /**
   * Perform a single poll
   */
  private async poll(isInitial: boolean): Promise<void> {
    this.pollCount++;
    const pollStartTime = Date.now();

    try {
      // Fetch trades using `after` parameter for incremental fetching
      const trades = this.lastTradeTimestamp
        ? await this.api.getTrades(this.config.traderAddress, {
            limit: 50,
            after: this.lastTradeTimestamp
          })
        : await this.api.getTrades(this.config.traderAddress, { limit: 50 });

      const pollLatencyMs = Date.now() - pollStartTime;
      const detectedAt = new Date();

      // Filter out trades we've already seen (deduplication)
      const newTrades = trades.filter(t => !this.seenTradeIds.has(t.id));

      // On initial poll, just record the baseline without emitting
      if (isInitial) {
        console.log(`[ActivityPoller] 📥 Initial snapshot: ${trades.length} recent trades`);
        this.logTradesSummary(trades.slice(0, 5));

        // Record all seen trade IDs
        for (const trade of trades) {
          this.seenTradeIds.add(trade.id);
        }

        // Set the timestamp to the most recent trade
        if (trades.length > 0) {
          // Trades are typically sorted newest first
          const mostRecent = trades.reduce((latest, t) =>
            t.timestamp > latest.timestamp ? t : latest, trades[0]);
          this.lastTradeTimestamp = Math.floor(mostRecent.timestamp.getTime() / 1000);
        } else {
          // No trades yet, use current time
          this.lastTradeTimestamp = Math.floor(Date.now() / 1000);
        }
      } else {
        // Process new trades (emit events)
        for (const trade of newTrades) {
          this.seenTradeIds.add(trade.id);
          this.tradesDetected++;

          const detectionLatencyMs = detectedAt.getTime() - trade.timestamp.getTime();
          this.recordLatency(detectionLatencyMs);

          const latency: TradeLatency = {
            detectionLatencyMs,
            tradeTimestamp: trade.timestamp,
            detectedAt,
          };

          this.logTrade(trade, latency);
          this.emit('trade', { trade, latency });
        }

        // Update last timestamp for next incremental fetch
        if (newTrades.length > 0) {
          const mostRecent = newTrades.reduce((latest, t) =>
            t.timestamp > latest.timestamp ? t : latest, newTrades[0]);
          this.lastTradeTimestamp = Math.floor(mostRecent.timestamp.getTime() / 1000);
        }
      }

      this.lastPollTime = new Date();
      this.emit('poll', newTrades, pollLatencyMs);

      // Handle error recovery
      if (this.consecutiveErrors >= (this.config.maxConsecutiveErrors || 5)) {
        console.log('[ActivityPoller] ✅ Recovered from errors');
        this.emit('recovered');
      }
      this.consecutiveErrors = 0;

      // Limit the size of seenTradeIds to prevent memory leaks
      if (this.seenTradeIds.size > 1000) {
        // Keep only the most recent 500
        const idsArray = Array.from(this.seenTradeIds);
        this.seenTradeIds = new Set(idsArray.slice(-500));
      }

      // Log progress periodically
      if (this.pollCount % 100 === 0) {
        console.log(`[ActivityPoller] 📊 Poll #${this.pollCount} | ${this.tradesDetected} total trades detected`);
        this.logLatencyStats();
      }

    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Record a latency sample
   */
  private recordLatency(latencyMs: number): void {
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > this.maxLatencySamples) {
      this.latencySamples.shift();
    }
  }

  /**
   * Handle polling errors
   */
  private handleError(error: Error): void {
    this.consecutiveErrors++;

    const errType = error.message.split(':')[0] || 'UNKNOWN';
    console.error(`[ActivityPoller] ❌ Error #${this.consecutiveErrors}: ${errType}`);

    this.emit('error', error);

    // Check for degraded state
    if (this.consecutiveErrors === (this.config.maxConsecutiveErrors || 5)) {
      console.error(`[ActivityPoller] ⚠️ DEGRADED: ${this.consecutiveErrors} consecutive errors!`);
      this.emit('degraded', this.consecutiveErrors);
    }

    // Rate limit errors - back off
    if (error.message.includes('RATE_LIMITED')) {
      console.log('[ActivityPoller] 🐢 Rate limited - backing off...');
      this.pause();
      setTimeout(() => this.resume(), 5000);
    }
  }

  /**
   * Log a detected trade nicely
   */
  private logTrade(trade: Trade, latency: TradeLatency): void {
    const emoji = trade.side === 'BUY' ? '🟢' : '🔴';
    const action = trade.side === 'BUY' ? 'BOUGHT' : 'SOLD';

    console.log('\n' + '─'.repeat(50));
    console.log(`${emoji} TRADE DETECTED!`);
    console.log('─'.repeat(50));
    console.log(`  Action: ${action} ${trade.size.toFixed(2)} shares @ $${trade.price.toFixed(4)}`);
    console.log(`  Token: ${trade.tokenId.slice(0, 40)}...`);
    if (trade.marketTitle) {
      console.log(`  Market: ${trade.marketTitle}`);
    }
    console.log(`  Trade Time: ${trade.timestamp.toISOString()}`);
    console.log(`  Detected At: ${latency.detectedAt.toISOString()}`);
    console.log(`  Detection Latency: ${latency.detectionLatencyMs}ms`);
    console.log('─'.repeat(50) + '\n');
  }

  /**
   * Log a summary of trades
   */
  private logTradesSummary(trades: Trade[]): void {
    if (trades.length === 0) {
      console.log('  (No recent trades)');
      return;
    }

    for (const trade of trades) {
      const emoji = trade.side === 'BUY' ? '🟢' : '🔴';
      const title = trade.marketTitle || trade.tokenId.slice(0, 30) + '...';
      console.log(`  ${emoji} ${trade.side} ${trade.size.toFixed(2)} @ $${trade.price.toFixed(4)} | ${title}`);
    }
  }

  /**
   * Log latency statistics
   */
  private logLatencyStats(): void {
    const stats = this.getLatencyStats();
    if (stats.sampleCount === 0) {
      return;
    }

    console.log(`[ActivityPoller] 📈 Latency Stats (${stats.sampleCount} samples):`);
    console.log(`  Avg: ${stats.avgDetectionLatencyMs.toFixed(0)}ms | Min: ${stats.minDetectionLatencyMs}ms | Max: ${stats.maxDetectionLatencyMs}ms`);
  }

  /**
   * Get latency statistics
   */
  getLatencyStats(): LatencyStats {
    if (this.latencySamples.length === 0) {
      return {
        avgDetectionLatencyMs: 0,
        minDetectionLatencyMs: 0,
        maxDetectionLatencyMs: 0,
        sampleCount: 0,
      };
    }

    const sum = this.latencySamples.reduce((a, b) => a + b, 0);
    return {
      avgDetectionLatencyMs: sum / this.latencySamples.length,
      minDetectionLatencyMs: Math.min(...this.latencySamples),
      maxDetectionLatencyMs: Math.max(...this.latencySamples),
      sampleCount: this.latencySamples.length,
    };
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      pollCount: this.pollCount,
      tradesDetected: this.tradesDetected,
      consecutiveErrors: this.consecutiveErrors,
      lastPollTime: this.lastPollTime,
      lastTradeTimestamp: this.lastTradeTimestamp,
      traderAddress: this.config.traderAddress,
      latencyStats: this.getLatencyStats(),
    };
  }

  /**
   * Check if running
   */
  running(): boolean {
    return this.isRunning && !this.isPaused;
  }

  /**
   * Get the API instance (for sharing with other components)
   */
  getApi(): PolymarketAPI {
    return this.api;
  }
}
