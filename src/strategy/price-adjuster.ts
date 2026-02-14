/**
 * PRICE ADJUSTER
 * ==============
 * Adjusts the order price to improve fill probability.
 *
 * When copying a trade, we're always a bit behind. The price may have
 * moved since the trader bought. Adding a small buffer helps ensure
 * our order gets filled.
 *
 * NEW: Spread-adaptive mode. When the spread is wide (volatile market),
 * the offset scales up automatically so we don't place orders in the
 * middle of nowhere. When the spread is tight, we use the base offset.
 *
 * Offset formula in adaptive mode:
 *   effectiveOffset = max(baseOffset, spreadBps × spreadMultiplier)
 *   capped at maxAdaptiveOffsetBps
 *
 * Example (normal market):
 *   Spread: 30bps, base offset: 50bps → uses 50bps (base wins)
 *
 * Example (volatile market):
 *   Spread: 400bps, multiplier: 0.5 → 200bps, base: 50bps → uses 200bps
 */

import { MarketSnapshot } from "../types";

/**
 * Adjust a price for better fill probability
 */
export function adjustPrice(
  marketPrice: number,
  offsetBps: number,
  side: "BUY" | "SELL"
): number {
  const offsetMultiplier = offsetBps / 10000;

  let adjustedPrice: number;

  if (side === "BUY") {
    adjustedPrice = marketPrice * (1 + offsetMultiplier);
  } else {
    adjustedPrice = marketPrice * (1 - offsetMultiplier);
  }

  // Clamp to valid range [0.01, 0.99]
  adjustedPrice = Math.max(0.01, Math.min(0.99, adjustedPrice));

  // Round to 4 decimal places
  adjustedPrice = Math.round(adjustedPrice * 10000) / 10000;

  return adjustedPrice;
}

/**
 * Calculate the cost difference from price adjustment
 */
export function calculateSlippageCost(
  shares: number,
  marketPrice: number,
  adjustedPrice: number
): number {
  return shares * (adjustedPrice - marketPrice);
}

/**
 * Price adjuster class with spread-adaptive offset
 */
export class PriceAdjuster {
  private defaultOffsetBps: number;

  /** When spread exceeds this, switch to adaptive mode */
  private adaptiveThresholdBps: number;
  /** Multiply spread by this to get adaptive offset */
  private spreadMultiplier: number;
  /** Never exceed this offset even in adaptive mode */
  private maxAdaptiveOffsetBps: number;

  constructor(
    defaultOffsetBps: number = 50,
    options: {
      adaptiveThresholdBps?: number;
      spreadMultiplier?: number;
      maxAdaptiveOffsetBps?: number;
    } = {}
  ) {
    this.defaultOffsetBps = defaultOffsetBps;
    this.adaptiveThresholdBps = options.adaptiveThresholdBps ?? 150;
    this.spreadMultiplier = options.spreadMultiplier ?? 0.5;
    this.maxAdaptiveOffsetBps = options.maxAdaptiveOffsetBps ?? 300;
  }

  /**
   * Adjust price with default offset (non-adaptive, backward compatible)
   */
  adjust(marketPrice: number, side: "BUY" | "SELL"): number {
    return adjustPrice(marketPrice, this.defaultOffsetBps, side);
  }

  /**
   * Adjust price with spread-adaptive offset using market snapshot.
   *
   * If the spread is normal, uses the base offset.
   * If the spread is wide, scales the offset proportionally.
   */
  adjustAdaptive(
    marketPrice: number,
    side: "BUY" | "SELL",
    snapshot: MarketSnapshot
  ): { adjustedPrice: number; effectiveOffsetBps: number; adaptive: boolean } {
    const effectiveOffsetBps = this.calculateAdaptiveOffset(snapshot.spreadBps);
    const adaptive = effectiveOffsetBps > this.defaultOffsetBps;

    return {
      adjustedPrice: adjustPrice(marketPrice, effectiveOffsetBps, side),
      effectiveOffsetBps,
      adaptive,
    };
  }

  /**
   * Calculate the effective offset based on current spread.
   *
   * - Below threshold: use base offset
   * - Above threshold: use spread × multiplier (capped)
   */
  calculateAdaptiveOffset(spreadBps: number): number {
    if (spreadBps <= this.adaptiveThresholdBps) {
      return this.defaultOffsetBps;
    }

    const spreadBasedOffset = spreadBps * this.spreadMultiplier;
    const adaptiveOffset = Math.max(this.defaultOffsetBps, spreadBasedOffset);

    return Math.min(adaptiveOffset, this.maxAdaptiveOffsetBps);
  }

  /**
   * Adjust price with custom offset
   */
  adjustWithOffset(
    marketPrice: number,
    side: "BUY" | "SELL",
    offsetBps: number
  ): number {
    return adjustPrice(marketPrice, offsetBps, side);
  }

  /**
   * Get adjustment details for logging
   */
  getAdjustmentDetails(
    marketPrice: number,
    side: "BUY" | "SELL",
    shares: number
  ): {
    originalPrice: number;
    adjustedPrice: number;
    offsetBps: number;
    slippageCost: number;
    description: string;
  } {
    const adjustedPrice = this.adjust(marketPrice, side);
    const slippageCost = calculateSlippageCost(
      shares,
      marketPrice,
      adjustedPrice
    );

    const direction = side === "BUY" ? "higher" : "lower";
    const costWord = slippageCost >= 0 ? "extra cost" : "less received";

    return {
      originalPrice: marketPrice,
      adjustedPrice,
      offsetBps: this.defaultOffsetBps,
      slippageCost,
      description: `Price adjusted ${direction} by ${this.defaultOffsetBps}bps: $${marketPrice.toFixed(4)} → $${adjustedPrice.toFixed(4)} (${costWord}: $${Math.abs(slippageCost).toFixed(4)})`,
    };
  }

  /**
   * Get adaptive adjustment details for logging
   */
  getAdaptiveAdjustmentDetails(
    marketPrice: number,
    side: "BUY" | "SELL",
    shares: number,
    snapshot: MarketSnapshot
  ): {
    originalPrice: number;
    adjustedPrice: number;
    effectiveOffsetBps: number;
    adaptive: boolean;
    slippageCost: number;
    description: string;
  } {
    const { adjustedPrice, effectiveOffsetBps, adaptive } =
      this.adjustAdaptive(marketPrice, side, snapshot);
    const slippageCost = calculateSlippageCost(
      shares,
      marketPrice,
      adjustedPrice
    );

    const direction = side === "BUY" ? "higher" : "lower";
    const costWord = slippageCost >= 0 ? "extra cost" : "less received";
    const modeLabel = adaptive
      ? `ADAPTIVE (spread: ${snapshot.spreadBps.toFixed(0)}bps)`
      : "static";

    return {
      originalPrice: marketPrice,
      adjustedPrice,
      effectiveOffsetBps,
      adaptive,
      slippageCost,
      description: `Price adjusted ${direction} by ${effectiveOffsetBps.toFixed(0)}bps [${modeLabel}]: $${marketPrice.toFixed(4)} → $${adjustedPrice.toFixed(4)} (${costWord}: $${Math.abs(slippageCost).toFixed(4)})`,
    };
  }

  setDefaultOffset(bps: number): void {
    this.defaultOffsetBps = bps;
  }

  getDefaultOffset(): number {
    return this.defaultOffsetBps;
  }
}
