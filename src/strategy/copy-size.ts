/**
 * COPY SIZE CALCULATOR
 * ====================
 * Calculates how many shares to trade when copying a trader.
 *
 * BUY strategies:
 * 1. proportional_to_portfolio - Use X% of YOUR balance per trade
 * 2. proportional_to_trader - Copy a fraction of what THEY bought
 * 3. fixed - Always buy the same amount
 *
 * SELL strategies:
 * 1. proportional - Sell same % of your position as trader sold
 * 2. full_exit - Sell all when trader sells any
 * 3. match_delta - Sell same number of shares (capped at your position)
 *
 * Example (BUY):
 *   Trader buys 1000 shares
 *   Your balance: $500
 *   Strategy: proportional_to_portfolio at 5%
 *   → You buy $25 worth of shares
 *
 * Example (SELL):
 *   Trader had 1000 shares, sells 500 (50%)
 *   You have 100 shares
 *   Strategy: proportional
 *   → You sell 50 shares (50% of your position)
 */

import { PositionChange, CopyConfig, SellStrategy, BelowMinLimitAction, MarketSnapshot } from '../types';

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

  /** Your current position in this token (for SELL calculations) */
  yourPosition?: number;

  /** Trader's estimated portfolio value (for proportional_to_trader) */
  traderPortfolioValue?: number;
}

/**
 * Output from the calculator
 */
export interface CopySizeResult {
  /** Number of shares to trade */
  shares: number;

  /** Estimated cost/proceeds in USD */
  estimatedCost: number;

  /** Why this size was chosen */
  reason: string;

  /** Was the size adjusted? (e.g., capped, rounded) */
  adjustments: string[];

  /** The side of the trade */
  side: 'BUY' | 'SELL';
}

/**
 * Polymarket minimum order size
 */
export const POLYMARKET_MIN_SHARES = 5;

/**
 * Default configuration
 */
export const DEFAULT_COPY_CONFIG: CopyConfig = {
  sizingMethod: 'proportional_to_portfolio',
  portfolioPercentage: 0.05, // 5% per trade
  priceOffsetBps: 50, // 0.5% price buffer
  minOrderSize: POLYMARKET_MIN_SHARES, // Polymarket requires minimum 5 shares
  maxPositionPerToken: 1000, // Max 1000 shares per token
  maxTotalPosition: 5000, // Max 5000 total
  sellStrategy: 'proportional', // Match trader's % reduction
  orderType: 'limit', // Use limit orders
  orderExpirationSeconds: 30, // Cancel after 30s if not filled
  belowMinLimitAction: 'buy_at_min', // Buy at minimum when below limit
};

export class CopySizeCalculator {
  private config: CopyConfig;

  constructor(config: Partial<CopyConfig> = {}) {
    this.config = { ...DEFAULT_COPY_CONFIG, ...config };
  }

  /**
   * Calculate how many shares to copy (BUY or SELL)
   *
   * @param input - Information about the trade and your balance/position
   * @returns The calculated size and reasoning
   */
  calculate(input: CopySizeInput): CopySizeResult {
    const { change } = input;

    if (change.side === 'BUY') {
      return this.calculateBuy(input);
    } else {
      return this.calculateSell(input);
    }
  }

  /**
   * Calculate BUY size
   */
  private calculateBuy(input: CopySizeInput): CopySizeResult {
    const { change, currentPrice, yourBalance } = input;
    const adjustments: string[] = [];

    // Safety check: price must be valid
    if (currentPrice <= 0 || currentPrice > 1) {
      return {
        shares: 0,
        estimatedCost: 0,
        reason: `Invalid price: ${currentPrice}`,
        adjustments: ['REJECTED: Invalid price'],
        side: 'BUY',
      };
    }

    // Safety check: must have balance
    if (yourBalance <= 0) {
      return {
        shares: 0,
        estimatedCost: 0,
        reason: 'No balance available',
        adjustments: ['REJECTED: No balance'],
        side: 'BUY',
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
      adjustments.push(
        `Capped from ${finalShares.toFixed(2)} to ${this.config.maxPositionPerToken} (max per token)`
      );
      finalShares = this.config.maxPositionPerToken;
    }

    // 2. Check minimum order size
    if (finalShares < this.config.minOrderSize && finalShares > 0) {
      const belowMinAction = this.config.belowMinLimitAction || 'skip';

      if (belowMinAction === 'buy_at_min') {
        // Buy at minimum order size (Polymarket requires 5 shares minimum)
        const minSize = Math.max(this.config.minOrderSize, POLYMARKET_MIN_SHARES);
        adjustments.push(
          `Below minimum (${finalShares.toFixed(2)} < ${this.config.minOrderSize}), buying at min: ${minSize} shares`
        );
        finalShares = minSize;
      } else {
        // Skip the trade
        adjustments.push(
          `Below minimum (${finalShares.toFixed(2)} < ${this.config.minOrderSize}), skipping trade`
        );
        finalShares = 0;
      }
    }

    // 3. Round to reasonable precision (2 decimal places)
    const roundedShares = Math.floor(finalShares * 100) / 100;
    if (roundedShares !== finalShares) {
      adjustments.push(
        `Rounded from ${finalShares.toFixed(4)} to ${roundedShares.toFixed(2)}`
      );
      finalShares = roundedShares;
    }

    // Calculate estimated cost
    const estimatedCost = finalShares * currentPrice;

    // Final safety check: can we afford it?
    if (estimatedCost > yourBalance) {
      const affordableShares =
        Math.floor((yourBalance / currentPrice) * 100) / 100;
      adjustments.push(
        `Reduced to affordable: ${affordableShares.toFixed(2)} shares ($${yourBalance.toFixed(2)} balance)`
      );
      finalShares = affordableShares;
    }

    return {
      shares: finalShares,
      estimatedCost: finalShares * currentPrice,
      reason,
      adjustments,
      side: 'BUY',
    };
  }

  /**
   * Calculate SELL size based on configured sell strategy
   */
  private calculateSell(input: CopySizeInput): CopySizeResult {
    const { change, currentPrice, yourPosition } = input;
    const adjustments: string[] = [];
    const sellStrategy = this.config.sellStrategy || 'proportional';

    // Safety check: price must be valid
    if (currentPrice <= 0 || currentPrice > 1) {
      return {
        shares: 0,
        estimatedCost: 0,
        reason: `Invalid price: ${currentPrice}`,
        adjustments: ['REJECTED: Invalid price'],
        side: 'SELL',
      };
    }

    // Safety check: must have a position to sell
    if (!yourPosition || yourPosition <= 0) {
      return {
        shares: 0,
        estimatedCost: 0,
        reason: 'No position to sell',
        adjustments: ['REJECTED: No position'],
        side: 'SELL',
      };
    }

    let rawShares: number;
    let reason: string;

    switch (sellStrategy) {
      case 'proportional':
        // Sell the same percentage the trader sold
        // Trader had X shares, sold Y, so they sold Y/X percent
        // If trader's previous quantity is available, calculate %
        if (change.previousQuantity > 0) {
          const traderSellPercent = change.delta / change.previousQuantity;
          rawShares = yourPosition * traderSellPercent;
          reason = `Trader sold ${(traderSellPercent * 100).toFixed(1)}% (${change.delta}/${change.previousQuantity}), selling ${(traderSellPercent * 100).toFixed(1)}% of your ${yourPosition} = ${rawShares.toFixed(2)} shares`;
        } else {
          // Fallback: sell same number of shares
          rawShares = Math.min(change.delta, yourPosition);
          reason = `Proportional fallback: selling ${rawShares.toFixed(2)} shares`;
        }
        break;

      case 'full_exit':
        // Sell everything when trader sells anything
        rawShares = yourPosition;
        reason = `Full exit: trader sold, liquidating all ${yourPosition} shares`;
        break;

      case 'match_delta':
        // Sell exact same number of shares (capped at your position)
        rawShares = Math.min(change.delta, yourPosition);
        if (change.delta > yourPosition) {
          adjustments.push(
            `Capped to position: trader sold ${change.delta}, you only have ${yourPosition}`
          );
        }
        reason = `Match delta: selling ${rawShares.toFixed(2)} shares (trader sold ${change.delta})`;
        break;

      default:
        rawShares = 0;
        reason = `Unknown sell strategy: ${sellStrategy}`;
    }

    // Apply adjustments
    let finalShares = rawShares;

    // Cap at your position
    if (finalShares > yourPosition) {
      adjustments.push(
        `Capped from ${finalShares.toFixed(2)} to ${yourPosition} (your position)`
      );
      finalShares = yourPosition;
    }

    // Check minimum order size
    if (finalShares < this.config.minOrderSize && finalShares > 0) {
      // For SELL, if we have less than min but want to close, allow it
      if (finalShares === yourPosition) {
        adjustments.push(
          `Below minimum but closing position (${finalShares.toFixed(2)} shares)`
        );
      } else {
        adjustments.push(
          `Below minimum (${finalShares.toFixed(2)} < ${this.config.minOrderSize})`
        );
        finalShares = 0;
      }
    }

    // Round to 2 decimal places
    const roundedShares = Math.floor(finalShares * 100) / 100;
    if (roundedShares !== finalShares) {
      adjustments.push(
        `Rounded from ${finalShares.toFixed(4)} to ${roundedShares.toFixed(2)}`
      );
      finalShares = roundedShares;
    }

    // Calculate estimated proceeds
    const estimatedProceeds = finalShares * currentPrice;

    return {
      shares: finalShares,
      estimatedCost: estimatedProceeds, // For SELL, this is proceeds
      reason,
      adjustments,
      side: 'SELL',
    };
  }

  /**
   * Quick check if a trade should be copied at all
   *
   * @param change - The detected position change
   * @param yourPosition - Your current position (required for SELL)
   */
  shouldCopy(
    change: PositionChange,
    yourPosition?: number
  ): { copy: boolean; reason: string } {
    // Check if delta is meaningful
    if (change.delta < 1) {
      return { copy: false, reason: 'Change too small (< 1 share)' };
    }

    if (change.side === 'SELL') {
      // For SELL, must have a position
      if (!yourPosition || yourPosition <= 0) {
        return { copy: false, reason: 'No position to sell' };
      }
      return { copy: true, reason: 'OK - SELL signal' };
    }

    return { copy: true, reason: 'OK - BUY signal' };
  }

  /**
   * Adjust calculated size based on order book depth.
   *
   * If the book near the best price can't support our full order,
   * we scale down proportionally to avoid walking the book and
   * getting filled at much worse prices.
   *
   * @param calculatedShares - Shares from the standard calculate() method
   * @param snapshot - Market snapshot with depth data
   * @param side - BUY or SELL
   * @returns Adjusted shares and adjustment reason (if any)
   */
  adjustForDepth(
    calculatedShares: number,
    snapshot: MarketSnapshot,
    side: "BUY" | "SELL"
  ): { shares: number; adjustment?: string } {
    if (calculatedShares <= 0) return { shares: 0 };

    const nearDepth = side === "BUY" ? snapshot.askDepthNear : snapshot.bidDepthNear;

    // If we have no depth data (e.g., price-only snapshot), skip adjustment
    if (nearDepth <= 0) return { shares: calculatedShares };

    // If our order fits within available depth, no adjustment needed
    if (calculatedShares <= nearDepth) return { shares: calculatedShares };

    // Scale down to available depth (never more than what the book can absorb near best price)
    // Use 80% of depth as a safety margin to avoid sweeping the entire level
    const safeSize = Math.floor(nearDepth * 0.8 * 100) / 100;
    const reduced = Math.max(safeSize, this.config.minOrderSize);
    const finalShares = Math.min(reduced, calculatedShares);

    return {
      shares: finalShares,
      adjustment: `Reduced from ${calculatedShares.toFixed(2)} to ${finalShares.toFixed(2)} shares (book depth: ${nearDepth.toFixed(0)} near best price)`,
    };
  }

  /**
   * Calculate the adaptive expiration based on market conditions.
   *
   * Wide spread / volatile = shorter expiration (don't leave orders hanging)
   * Normal conditions = use configured expiration
   */
  getAdaptiveExpiration(
    snapshot: MarketSnapshot,
    baseExpirationSeconds: number
  ): { expirationSeconds: number; reason?: string } {
    if (!snapshot.isVolatile) {
      return { expirationSeconds: baseExpirationSeconds };
    }

    // In volatile conditions, use half the normal expiration (min 5 seconds)
    const reduced = Math.max(5, Math.floor(baseExpirationSeconds / 2));
    return {
      expirationSeconds: reduced,
      reason: `Volatile market (${snapshot.condition}) → expiration reduced from ${baseExpirationSeconds}s to ${reduced}s`,
    };
  }

  /**
   * Get order configuration for building OrderSpec
   */
  getOrderConfig(): {
    orderType: 'limit' | 'market';
    expirationSeconds: number;
    priceOffsetBps: number;
  } {
    return {
      orderType: this.config.orderType || 'limit',
      expirationSeconds: this.config.orderExpirationSeconds || 30,
      priceOffsetBps: this.config.priceOffsetBps,
    };
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
