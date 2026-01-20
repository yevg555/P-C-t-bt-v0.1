/**
 * COPY SIZE CALCULATOR
 * ====================
 * Calculates how many shares YOU should buy when the trader buys.
 * 
 * Three strategies:
 * 1. proportional_to_portfolio - Use X% of YOUR balance per trade
 * 2. proportional_to_trader - Copy a fraction of what THEY bought
 * 3. fixed - Always buy the same amount
 * 
 * Example:
 *   Trader buys 1000 shares
 *   Your balance: $500
 *   Strategy: proportional_to_portfolio at 5%
 *   → You buy $25 worth of shares
 */

import { PositionChange, CopyConfig } from '../types';

/**
 * Input needed to calculate copy size
 */
export interface CopySizeInput {
  /** The detected change (what the trader did) */
  change: PositionChange;
  
  /** Current market price of the token (0.0 to 1.0) */
  currentPrice: number;
  
  /** Your available balance in USD */
  yourBalance: number;
  
  /** Trader's estimated portfolio value (for proportional_to_trader) */
  traderPortfolioValue?: number;
}

/**
 * Output from the calculator
 */
export interface CopySizeResult {
  /** Number of shares to trade */
  shares: number;
  
  /** Estimated cost in USD */
  estimatedCost: number;
  
  /** Why this size was chosen */
  reason: string;
  
  /** Was the size adjusted? (e.g., capped, rounded) */
  adjustments: string[];
}

/**
 * Default configuration
 */
export const DEFAULT_COPY_CONFIG: CopyConfig = {
  sizingMethod: 'proportional_to_portfolio',
  portfolioPercentage: 0.05,  // 5% per trade
  priceOffsetBps: 50,         // 0.5% price buffer
  minOrderSize: 10,           // Minimum 10 shares
  maxPositionPerToken: 1000,  // Max 1000 shares per token
  maxTotalPosition: 5000,     // Max 5000 total
};

export class CopySizeCalculator {
  private config: CopyConfig;
  
  constructor(config: Partial<CopyConfig> = {}) {
    this.config = { ...DEFAULT_COPY_CONFIG, ...config };
  }
  
  /**
   * Calculate how many shares to copy
   * 
   * @param input - Information about the trade and your balance
   * @returns The calculated size and reasoning
   */
  calculate(input: CopySizeInput): CopySizeResult {
    const { change, currentPrice, yourBalance } = input;
    const adjustments: string[] = [];
    
    // Safety check: price must be valid
    if (currentPrice <= 0 || currentPrice > 1) {
      return {
        shares: 0,
        estimatedCost: 0,
        reason: `Invalid price: ${currentPrice}`,
        adjustments: ['REJECTED: Invalid price'],
      };
    }
    
    // Safety check: must have balance
    if (yourBalance <= 0) {
      return {
        shares: 0,
        estimatedCost: 0,
        reason: 'No balance available',
        adjustments: ['REJECTED: No balance'],
      };
    }
    
    // Calculate raw size based on strategy
    let rawShares: number;
    let reason: string;
    
    switch (this.config.sizingMethod) {
      case 'proportional_to_portfolio':
        // Use X% of your portfolio per trade
        const usdToSpend = yourBalance * this.config.portfolioPercentage;
        rawShares = usdToSpend / currentPrice;
        reason = `${(this.config.portfolioPercentage * 100).toFixed(1)}% of $${yourBalance.toFixed(2)} = $${usdToSpend.toFixed(2)} → ${rawShares.toFixed(2)} shares @ $${currentPrice.toFixed(4)}`;
        break;
        
      case 'proportional_to_trader':
        // Copy a fraction of what the trader did
        if (!input.traderPortfolioValue || input.traderPortfolioValue <= 0) {
          // Fallback: just copy 10% of their trade
          rawShares = change.delta * 0.1;
          reason = `10% of trader's ${change.delta} shares (no portfolio value)`;
        } else {
          // Scale based on portfolio ratio
          const ratio = yourBalance / input.traderPortfolioValue;
          rawShares = change.delta * ratio;
          reason = `Trader bought ${change.delta}, your ratio is ${(ratio * 100).toFixed(2)}% → ${rawShares.toFixed(2)} shares`;
        }
        break;
        
      case 'fixed':
        // Always use the same percentage, regardless of what trader did
        const fixedUsd = yourBalance * this.config.portfolioPercentage;
        rawShares = fixedUsd / currentPrice;
        reason = `Fixed ${(this.config.portfolioPercentage * 100).toFixed(1)}% = $${fixedUsd.toFixed(2)} → ${rawShares.toFixed(2)} shares`;
        break;
        
      default:
        rawShares = 0;
        reason = `Unknown sizing method: ${this.config.sizingMethod}`;
    }
    
    // Apply adjustments
    let finalShares = rawShares;
    
    // 1. Apply maximum per token
    if (finalShares > this.config.maxPositionPerToken) {
      adjustments.push(`Capped from ${finalShares.toFixed(2)} to ${this.config.maxPositionPerToken} (max per token)`);
      finalShares = this.config.maxPositionPerToken;
    }
    
    // 2. Check minimum order size
    if (finalShares < this.config.minOrderSize && finalShares > 0) {
      adjustments.push(`Below minimum (${finalShares.toFixed(2)} < ${this.config.minOrderSize})`);
      // Depending on config, either skip or round up
      finalShares = 0; // Skip tiny orders
    }
    
    // 3. Round to reasonable precision (2 decimal places)
    const roundedShares = Math.floor(finalShares * 100) / 100;
    if (roundedShares !== finalShares) {
      adjustments.push(`Rounded from ${finalShares.toFixed(4)} to ${roundedShares.toFixed(2)}`);
      finalShares = roundedShares;
    }
    
    // Calculate estimated cost
    const estimatedCost = finalShares * currentPrice;
    
    // Final safety check: can we afford it?
    if (estimatedCost > yourBalance) {
      const affordableShares = Math.floor((yourBalance / currentPrice) * 100) / 100;
      adjustments.push(`Reduced to affordable: ${affordableShares.toFixed(2)} shares ($${yourBalance.toFixed(2)} balance)`);
      finalShares = affordableShares;
    }
    
    return {
      shares: finalShares,
      estimatedCost: finalShares * currentPrice,
      reason,
      adjustments,
    };
  }
  
  /**
   * Quick check if a trade should be copied at all
   */
  shouldCopy(change: PositionChange): { copy: boolean; reason: string } {
    // Only copy BUY signals for now (SELL logic is more complex)
    if (change.side === 'SELL') {
      return { copy: false, reason: 'SELL signals not yet implemented' };
    }
    
    // Check if delta is meaningful
    if (change.delta < 1) {
      return { copy: false, reason: 'Change too small (< 1 share)' };
    }
    
    return { copy: true, reason: 'OK' };
  }
  
  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<CopyConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
  
  /**
   * Get current configuration
   */
  getConfig(): CopyConfig {
    return { ...this.config };
  }
}
