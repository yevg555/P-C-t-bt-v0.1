/**
 * POSITION POLLER
 * ===============
 * The main polling loop - the heart of the bot!
 * 
 * What it does:
 * 1. Calls the Polymarket API every X milliseconds
 * 2. Compares new positions with cached positions
 * 3. Emits 'change' events when trades are detected
 * 
 * You listen to these events and respond (copy the trade!)
 * 
 * @example
 * const poller = new PositionPoller({ traderAddress: '0x...', intervalMs: 200 });
 * 
 * poller.on('change', (change) => {
 *   console.log(`Trader ${change.side} ${change.delta} shares!`);
 *   // TODO: Copy the trade!
 * });
 * 
 * await poller.start();
 */

import { EventEmitter } from 'eventemitter3';
import { PolymarketAPI } from '../api/polymarket-api';
import { PositionCache } from './position-cache';
import { ChangeDetector } from './change-detector';
import { Position, PositionChange, PollerConfig } from '../types';

/**
 * Events emitted by the PositionPoller
 */
export interface PollerEvents {
  /** A position changed - this is what you care about! */
  change: (change: PositionChange) => void;
  
  /** Each poll completed (even if no changes) */
  poll: (positions: Position[]) => void;
  
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

export class PositionPoller extends EventEmitter<PollerEvents> {
  // Dependencies
  private api: PolymarketAPI;
  private cache: PositionCache;
  private detector: ChangeDetector;
  
  // Configuration
  private config: PollerConfig;
  
  // State
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isPaused = false;
  private consecutiveErrors = 0;
  private pollCount = 0;
  private changesDetected = 0;
  private lastPollTime: Date | null = null;
  
  constructor(config: PollerConfig) {
    super();
    
    this.config = {
      ...config,
      maxConsecutiveErrors: config.maxConsecutiveErrors || 5,
    };
    
    this.api = new PolymarketAPI();
    this.cache = new PositionCache();
    this.detector = new ChangeDetector();
  }
  
  /**
   * Start the polling loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[Poller] Already running');
      return;
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('[Poller] 🚀 Starting Position Poller');
    console.log('='.repeat(50));
    console.log(`  Trader:   ${this.config.traderAddress}`);
    console.log(`  Interval: ${this.config.intervalMs}ms`);
    console.log(`  Max Errors: ${this.config.maxConsecutiveErrors}`);
    console.log('='.repeat(50) + '\n');
    
    this.isRunning = true;
    this.emit('start');
    
    // Do first poll immediately
    await this.poll();
    
    // Then poll on interval
    this.intervalId = setInterval(() => {
      if (!this.isPaused) {
        this.poll().catch(err => {
          console.error('[Poller] Unhandled error:', err);
        });
      }
    }, this.config.intervalMs);
    
    console.log('[Poller] ✅ Polling started\n');
  }
  
  /**
   * Stop the polling loop
   */
  stop(): void {
    if (!this.isRunning) {
      console.log('[Poller] Not running');
      return;
    }
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isRunning = false;
    this.emit('stop');
    
    console.log('\n[Poller] ⏹️ Stopped');
    console.log(`  Total polls: ${this.pollCount}`);
    console.log(`  Changes detected: ${this.changesDetected}`);
  }
  
  /**
   * Temporarily pause polling (without stopping)
   */
  pause(): void {
    this.isPaused = true;
    console.log('[Poller] ⏸️ Paused');
  }
  
  /**
   * Resume after pause
   */
  resume(): void {
    this.isPaused = false;
    console.log('[Poller] ▶️ Resumed');
  }
  
  /**
   * Perform a single poll
   */
  private async poll(): Promise<void> {
    this.pollCount++;
    
    try {
      // 1. Fetch current positions
      const currentPositions = await this.api.getPositions(this.config.traderAddress);
      
      // 2. Get previous positions
      const previousPositions = this.cache.getAll();
      
      // 3. Detect changes (skip on first poll - just initializing)
      if (!this.cache.isEmpty()) {
        const changes = this.detector.detectChanges(previousPositions, currentPositions);
        
        // Emit each change
        for (const change of changes) {
          this.changesDetected++;
          this.logChange(change);
          this.emit('change', change);
        }
      } else {
        console.log(`[Poller] 📥 Initial snapshot: ${currentPositions.length} positions`);
        this.logPositionsSummary(currentPositions);
      }
      
      // 4. Update cache
      this.cache.update(currentPositions);
      this.lastPollTime = new Date();
      
      // 5. Emit poll event
      this.emit('poll', currentPositions);
      
      // 6. Handle error recovery
      if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
        // We were in degraded state, now recovered
        console.log('[Poller] ✅ Recovered from errors');
        this.emit('recovered');
      }
      this.consecutiveErrors = 0;
      
      // Log progress periodically
      if (this.pollCount % 100 === 0) {
        console.log(`[Poller] 📊 Poll #${this.pollCount} | ${currentPositions.length} positions | ${this.changesDetected} total changes`);
      }
      
    } catch (error) {
      this.handleError(error as Error);
    }
  }
  
  /**
   * Handle polling errors
   */
  private handleError(error: Error): void {
    this.consecutiveErrors++;
    
    const errType = error.message.split(':')[0] || 'UNKNOWN';
    console.error(`[Poller] ❌ Error #${this.consecutiveErrors}: ${errType}`);
    
    this.emit('error', error);
    
    // Check for degraded state
    if (this.consecutiveErrors === this.config.maxConsecutiveErrors) {
      console.error(`[Poller] ⚠️ DEGRADED: ${this.consecutiveErrors} consecutive errors!`);
      this.emit('degraded', this.consecutiveErrors);
    }
    
    // Rate limit errors - back off
    if (error.message.includes('RATE_LIMITED')) {
      console.log('[Poller] 🐢 Rate limited - backing off...');
      this.pause();
      setTimeout(() => this.resume(), 5000); // Wait 5 seconds
    }
  }
  
  /**
   * Log a detected change nicely
   */
  private logChange(change: PositionChange): void {
    const emoji = change.side === 'BUY' ? '🟢' : '🔴';
    const action = change.side === 'BUY' ? 'BOUGHT' : 'SOLD';
    
    console.log('\n' + '─'.repeat(50));
    console.log(`${emoji} TRADE DETECTED!`);
    console.log('─'.repeat(50));
    console.log(`  Action: ${action} ${change.delta.toFixed(2)} shares`);
    console.log(`  Position: ${change.previousQuantity.toFixed(2)} → ${change.currentQuantity.toFixed(2)}`);
    console.log(`  Token: ${change.tokenId.slice(0, 40)}...`);
    if (change.marketTitle) {
      console.log(`  Market: ${change.marketTitle}`);
    }
    console.log(`  Time: ${change.detectedAt.toISOString()}`);
    console.log('─'.repeat(50) + '\n');
  }
  
  /**
   * Log a summary of positions
   */
  private logPositionsSummary(positions: Position[]): void {
    if (positions.length === 0) {
      console.log('  (No positions)');
      return;
    }
    
    const top5 = positions.slice(0, 5);
    for (const pos of top5) {
      const title = pos.marketTitle || pos.tokenId.slice(0, 30) + '...';
      console.log(`  • ${pos.quantity.toFixed(2)} @ $${pos.avgPrice.toFixed(3)} | ${title}`);
    }
    
    if (positions.length > 5) {
      console.log(`  ... and ${positions.length - 5} more`);
    }
  }
  
  /**
   * Get current stats
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      pollCount: this.pollCount,
      changesDetected: this.changesDetected,
      cacheSize: this.cache.size(),
      consecutiveErrors: this.consecutiveErrors,
      lastPollTime: this.lastPollTime,
      traderAddress: this.config.traderAddress,
    };
  }
  
  /**
   * Check if running
   */
  running(): boolean {
    return this.isRunning && !this.isPaused;
  }
}
