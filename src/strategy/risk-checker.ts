/**
 * RISK CHECKER
 * ============
 * Validates trades against risk limits before execution.
 * 
 * Checks:
 * - Daily loss limit (stop if down $X today)
 * - Total loss limit (kill switch)
 * - Position limits (max shares per token)
 * - Balance checks (can we afford it?)
 * 
 * This is your safety net!
 */

import { RiskConfig, OrderSpec } from '../types';

/**
 * Current state of your trading
 */
export interface TradingState {
  /** Today's realized P&L */
  dailyPnL: number;
  
  /** Total realized P&L since start */
  totalPnL: number;
  
  /** Current balance in USD */
  balance: number;
  
  /** Current positions: tokenId -> quantity */
  positions: Map<string, number>;
  
  /** Total shares across all positions */
  totalShares: number;
}

/**
 * Result of a risk check
 */
export interface RiskCheckResult {
  /** Is the trade approved? */
  approved: boolean;
  
  /** If rejected, why? */
  reason?: string;
  
  /** Warnings (trade approved but be careful) */
  warnings: string[];
  
  /** Risk level: low, medium, high */
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Default risk configuration
 */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxDailyLoss: 100,   // Stop if down $100 today
  maxTotalLoss: 500,   // Kill switch at $500 total loss
};

export class RiskChecker {
  private config: RiskConfig;
  private isKillSwitchActive = false;
  
  constructor(config: Partial<RiskConfig> = {}) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
  }
  
  /**
   * Check if an order passes all risk checks
   * 
   * @param order - The order we want to place
   * @param state - Current trading state
   * @returns Whether the trade is approved
   */
  check(order: OrderSpec, state: TradingState): RiskCheckResult {
    const warnings: string[] = [];
    
    // === KILL SWITCH CHECK ===
    if (this.isKillSwitchActive) {
      return {
        approved: false,
        reason: 'KILL SWITCH ACTIVE - Trading halted',
        warnings: [],
        riskLevel: 'high',
      };
    }
    
    // === TOTAL LOSS CHECK ===
    if (state.totalPnL <= -this.config.maxTotalLoss) {
      this.activateKillSwitch('Total loss limit exceeded');
      return {
        approved: false,
        reason: `Total loss limit exceeded: $${Math.abs(state.totalPnL).toFixed(2)} >= $${this.config.maxTotalLoss}`,
        warnings: [],
        riskLevel: 'high',
      };
    }
    
    // === DAILY LOSS CHECK ===
    if (state.dailyPnL <= -this.config.maxDailyLoss) {
      return {
        approved: false,
        reason: `Daily loss limit exceeded: $${Math.abs(state.dailyPnL).toFixed(2)} >= $${this.config.maxDailyLoss}`,
        warnings: [],
        riskLevel: 'high',
      };
    }
    
    // === BALANCE CHECK ===
    const orderCost = order.size * order.price;
    if (order.side === 'BUY' && orderCost > state.balance) {
      return {
        approved: false,
        reason: `Insufficient balance: need $${orderCost.toFixed(2)}, have $${state.balance.toFixed(2)}`,
        warnings: [],
        riskLevel: 'medium',
      };
    }
    
    // === POSITION SIZE CHECK ===
    const currentPosition = state.positions.get(order.tokenId) || 0;
    const newPosition = order.side === 'BUY' 
      ? currentPosition + order.size 
      : currentPosition - order.size;
    
    // Can't sell more than we have
    if (order.side === 'SELL' && newPosition < 0) {
      return {
        approved: false,
        reason: `Cannot sell ${order.size} shares, only have ${currentPosition}`,
        warnings: [],
        riskLevel: 'medium',
      };
    }
    
    // === WARNING CHECKS (approved but risky) ===
    
    // Approaching daily loss limit
    const dailyLossPercent = Math.abs(state.dailyPnL) / this.config.maxDailyLoss;
    if (dailyLossPercent > 0.7) {
      warnings.push(`Approaching daily loss limit: ${(dailyLossPercent * 100).toFixed(0)}%`);
    }
    
    // Approaching total loss limit
    const totalLossPercent = Math.abs(state.totalPnL) / this.config.maxTotalLoss;
    if (totalLossPercent > 0.5) {
      warnings.push(`Approaching total loss limit: ${(totalLossPercent * 100).toFixed(0)}%`);
    }
    
    // Low balance warning
    if (state.balance < 50) {
      warnings.push(`Low balance: $${state.balance.toFixed(2)}`);
    }
    
    // Large order warning (> 20% of balance)
    if (orderCost > state.balance * 0.2) {
      warnings.push(`Large order: ${((orderCost / state.balance) * 100).toFixed(0)}% of balance`);
    }
    
    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (warnings.length > 2 || dailyLossPercent > 0.7 || totalLossPercent > 0.5) {
      riskLevel = 'high';
    } else if (warnings.length > 0) {
      riskLevel = 'medium';
    }
    
    return {
      approved: true,
      warnings,
      riskLevel,
    };
  }
  
  /**
   * Quick balance check
   */
  canAfford(cost: number, balance: number): boolean {
    return cost <= balance;
  }
  
  /**
   * Activate the kill switch (stops all trading)
   */
  activateKillSwitch(reason: string): void {
    this.isKillSwitchActive = true;
    console.error('\n' + '!'.repeat(50));
    console.error('!!! KILL SWITCH ACTIVATED !!!');
    console.error(`Reason: ${reason}`);
    console.error('!'.repeat(50) + '\n');
  }
  
  /**
   * Deactivate kill switch (manual reset required)
   */
  deactivateKillSwitch(): void {
    this.isKillSwitchActive = false;
    console.log('[Risk] Kill switch deactivated');
  }
  
  /**
   * Check if kill switch is active
   */
  isKillSwitchOn(): boolean {
    return this.isKillSwitchActive;
  }
  
  /**
   * Update risk configuration
   */
  updateConfig(newConfig: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
  
  /**
   * Get current configuration
   */
  getConfig(): RiskConfig {
    return { ...this.config };
  }
  
  /**
   * Get a summary of current risk status
   */
  getSummary(state: TradingState): string {
    const dailyPercent = ((state.dailyPnL / -this.config.maxDailyLoss) * 100).toFixed(1);
    const totalPercent = ((state.totalPnL / -this.config.maxTotalLoss) * 100).toFixed(1);
    
    return [
      `Risk Status:`,
      `  Daily P&L: $${state.dailyPnL.toFixed(2)} / -$${this.config.maxDailyLoss} (${dailyPercent}%)`,
      `  Total P&L: $${state.totalPnL.toFixed(2)} / -$${this.config.maxTotalLoss} (${totalPercent}%)`,
      `  Balance: $${state.balance.toFixed(2)}`,
      `  Kill Switch: ${this.isKillSwitchActive ? '🔴 ACTIVE' : '🟢 OFF'}`,
    ].join('\n');
  }
}
