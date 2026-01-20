/**
 * PRICE ADJUSTER
 * ==============
 * Adjusts the order price to improve fill probability.
 * 
 * When copying a trade, we're always a bit behind. The price may have
 * moved since the trader bought. Adding a small buffer helps ensure
 * our order gets filled.
 * 
 * Example:
 *   Market price: $0.65
 *   Offset: 50 basis points (0.5%)
 *   BUY price: $0.6533 (slightly higher, more likely to fill)
 *   SELL price: $0.6468 (slightly lower, more likely to fill)
 */

/**
 * Adjust a price for better fill probability
 * 
 * @param marketPrice - Current market price (0.0 to 1.0)
 * @param offsetBps - Offset in basis points (100 = 1%)
 * @param side - BUY or SELL
 * @returns Adjusted price
 */
export function adjustPrice(
  marketPrice: number,
  offsetBps: number,
  side: 'BUY' | 'SELL'
): number {
  // Convert basis points to multiplier
  // 50 bps = 0.5% = 0.005
  const offsetMultiplier = offsetBps / 10000;
  
  let adjustedPrice: number;
  
  if (side === 'BUY') {
    // For BUY: pay slightly MORE to ensure fill
    adjustedPrice = marketPrice * (1 + offsetMultiplier);
  } else {
    // For SELL: accept slightly LESS to ensure fill
    adjustedPrice = marketPrice * (1 - offsetMultiplier);
  }
  
  // Clamp to valid range [0.01, 0.99]
  // Polymarket prices must be between 1% and 99%
  adjustedPrice = Math.max(0.01, Math.min(0.99, adjustedPrice));
  
  // Round to 4 decimal places
  adjustedPrice = Math.round(adjustedPrice * 10000) / 10000;
  
  return adjustedPrice;
}

/**
 * Calculate the cost difference from price adjustment
 * 
 * @param shares - Number of shares
 * @param marketPrice - Original price
 * @param adjustedPrice - Adjusted price
 * @returns Extra cost (positive = paying more, negative = receiving less)
 */
export function calculateSlippageCost(
  shares: number,
  marketPrice: number,
  adjustedPrice: number
): number {
  return shares * (adjustedPrice - marketPrice);
}

/**
 * Price adjuster class for more complex scenarios
 */
export class PriceAdjuster {
  private defaultOffsetBps: number;
  
  constructor(defaultOffsetBps: number = 50) {
    this.defaultOffsetBps = defaultOffsetBps;
  }
  
  /**
   * Adjust price with default offset
   */
  adjust(marketPrice: number, side: 'BUY' | 'SELL'): number {
    return adjustPrice(marketPrice, this.defaultOffsetBps, side);
  }
  
  /**
   * Adjust price with custom offset
   */
  adjustWithOffset(marketPrice: number, side: 'BUY' | 'SELL', offsetBps: number): number {
    return adjustPrice(marketPrice, offsetBps, side);
  }
  
  /**
   * Get adjustment details for logging
   */
  getAdjustmentDetails(
    marketPrice: number,
    side: 'BUY' | 'SELL',
    shares: number
  ): {
    originalPrice: number;
    adjustedPrice: number;
    offsetBps: number;
    slippageCost: number;
    description: string;
  } {
    const adjustedPrice = this.adjust(marketPrice, side);
    const slippageCost = calculateSlippageCost(shares, marketPrice, adjustedPrice);
    
    const direction = side === 'BUY' ? 'higher' : 'lower';
    const costWord = slippageCost >= 0 ? 'extra cost' : 'less received';
    
    return {
      originalPrice: marketPrice,
      adjustedPrice,
      offsetBps: this.defaultOffsetBps,
      slippageCost,
      description: `Price adjusted ${direction} by ${this.defaultOffsetBps}bps: $${marketPrice.toFixed(4)} → $${adjustedPrice.toFixed(4)} (${costWord}: $${Math.abs(slippageCost).toFixed(4)})`,
    };
  }
  
  /**
   * Set default offset
   */
  setDefaultOffset(bps: number): void {
    this.defaultOffsetBps = bps;
  }
  
  /**
   * Get default offset
   */
  getDefaultOffset(): number {
    return this.defaultOffsetBps;
  }
}
