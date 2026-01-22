/**
 * AUTO TP/SL MONITOR
 * ==================
 * Monitors positions and automatically triggers exits when
 * take profit or stop loss thresholds are reached.
 *
 * How it works:
 * 1. Tracks entry price for each position
 * 2. Periodically checks current prices against TP/SL thresholds
 * 3. When threshold is hit, triggers a SELL order
 */

import { EventEmitter } from 'events';
import { AutoTpSlConfig, PaperPosition, OrderSpec } from '../types';

/**
 * Event emitted when TP/SL is triggered
 */
export interface TpSlTriggerEvent {
  tokenId: string;
  marketId?: string;
  triggerType: 'take_profit' | 'stop_loss';
  entryPrice: number;
  currentPrice: number;
  percentChange: number;
  quantity: number;
  order: OrderSpec;
}

/**
 * Default TP/SL configuration
 */
export const DEFAULT_TP_SL_CONFIG: AutoTpSlConfig = {
  enabled: false,
  takeProfitPercent: 0.10, // 10% profit
  stopLossPercent: 0.05,   // 5% loss
};

export class TpSlMonitor extends EventEmitter {
  private config: AutoTpSlConfig;
  private monitorInterval: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;

  constructor(config: Partial<AutoTpSlConfig> = {}, checkIntervalMs = 5000) {
    super();
    this.config = { ...DEFAULT_TP_SL_CONFIG, ...config };
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Check positions against TP/SL thresholds
   *
   * @param positions - Current positions with entry prices
   * @param currentPrices - Current market prices for each token
   * @returns Array of triggered TP/SL events
   */
  checkPositions(
    positions: Map<string, PaperPosition>,
    currentPrices: Map<string, number>
  ): TpSlTriggerEvent[] {
    if (!this.config.enabled) {
      return [];
    }

    const triggers: TpSlTriggerEvent[] = [];

    for (const [tokenId, position] of positions) {
      const currentPrice = currentPrices.get(tokenId);

      if (!currentPrice || !position.entryPrice) {
        continue;
      }

      const percentChange = (currentPrice - position.entryPrice) / position.entryPrice;

      // Check Take Profit
      if (
        this.config.takeProfitPercent &&
        this.config.takeProfitPercent > 0 &&
        percentChange >= this.config.takeProfitPercent
      ) {
        const order: OrderSpec = {
          tokenId,
          side: 'SELL',
          size: position.quantity,
          price: currentPrice,
          orderType: 'market',
        };

        triggers.push({
          tokenId,
          marketId: position.marketId,
          triggerType: 'take_profit',
          entryPrice: position.entryPrice,
          currentPrice,
          percentChange,
          quantity: position.quantity,
          order,
        });

        console.log(`\n[TP/SL] TAKE PROFIT triggered for ${tokenId.slice(0, 16)}...`);
        console.log(`  Entry: $${position.entryPrice.toFixed(4)} -> Current: $${currentPrice.toFixed(4)}`);
        console.log(`  Change: +${(percentChange * 100).toFixed(2)}% (threshold: ${(this.config.takeProfitPercent * 100).toFixed(1)}%)`);
      }

      // Check Stop Loss
      if (
        this.config.stopLossPercent &&
        this.config.stopLossPercent > 0 &&
        percentChange <= -this.config.stopLossPercent
      ) {
        const order: OrderSpec = {
          tokenId,
          side: 'SELL',
          size: position.quantity,
          price: currentPrice,
          orderType: 'market',
        };

        triggers.push({
          tokenId,
          marketId: position.marketId,
          triggerType: 'stop_loss',
          entryPrice: position.entryPrice,
          currentPrice,
          percentChange,
          quantity: position.quantity,
          order,
        });

        console.log(`\n[TP/SL] STOP LOSS triggered for ${tokenId.slice(0, 16)}...`);
        console.log(`  Entry: $${position.entryPrice.toFixed(4)} -> Current: $${currentPrice.toFixed(4)}`);
        console.log(`  Change: ${(percentChange * 100).toFixed(2)}% (threshold: -${(this.config.stopLossPercent * 100).toFixed(1)}%)`);
      }
    }

    return triggers;
  }

  /**
   * Start continuous monitoring
   *
   * @param getPositions - Function to get current positions
   * @param getPrices - Function to get current prices
   */
  startMonitoring(
    getPositions: () => Promise<Map<string, PaperPosition>>,
    getPrices: (tokenIds: string[]) => Promise<Map<string, number>>
  ): void {
    if (!this.config.enabled) {
      console.log('[TP/SL] Auto TP/SL is disabled');
      return;
    }

    if (this.monitorInterval) {
      this.stopMonitoring();
    }

    console.log('[TP/SL] Starting auto TP/SL monitoring');
    console.log(`  Take Profit: ${this.config.takeProfitPercent ? (this.config.takeProfitPercent * 100).toFixed(1) + '%' : 'disabled'}`);
    console.log(`  Stop Loss: ${this.config.stopLossPercent ? (this.config.stopLossPercent * 100).toFixed(1) + '%' : 'disabled'}`);
    console.log(`  Check interval: ${this.checkIntervalMs}ms`);

    this.monitorInterval = setInterval(async () => {
      try {
        const positions = await getPositions();

        if (positions.size === 0) {
          return;
        }

        const tokenIds = Array.from(positions.keys());
        const prices = await getPrices(tokenIds);

        const triggers = this.checkPositions(positions, prices);

        for (const trigger of triggers) {
          this.emit('trigger', trigger);
        }
      } catch (error) {
        console.error(`[TP/SL] Monitor error: ${error}`);
      }
    }, this.checkIntervalMs);
  }

  /**
   * Stop continuous monitoring
   */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      console.log('[TP/SL] Stopped auto TP/SL monitoring');
    }
  }

  /**
   * Check if monitoring is active
   */
  isMonitoring(): boolean {
    return this.monitorInterval !== null;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AutoTpSlConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoTpSlConfig {
    return { ...this.config };
  }

  /**
   * Get threshold info for display
   */
  getThresholdInfo(): string {
    if (!this.config.enabled) {
      return 'Auto TP/SL: DISABLED';
    }

    const parts: string[] = ['Auto TP/SL: ENABLED'];

    if (this.config.takeProfitPercent) {
      parts.push(`TP: +${(this.config.takeProfitPercent * 100).toFixed(1)}%`);
    }
    if (this.config.stopLossPercent) {
      parts.push(`SL: -${(this.config.stopLossPercent * 100).toFixed(1)}%`);
    }

    return parts.join(' | ');
  }
}
