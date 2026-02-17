/**
 * MARKET ANALYZER
 * ===============
 * Builds a full MarketSnapshot from the order book before every trade decision.
 *
 * Instead of a single scalar price, we now get:
 *   - Best bid / best ask / spread
 *   - Depth near the top of book
 *   - Weighted average fill price for our intended size
 *   - Divergence from the trader's execution price
 *   - A market condition assessment (normal / wide_spread / thin_book / etc.)
 *
 * This feeds into:
 *   - PriceAdjuster (adaptive offset based on spread)
 *   - CopySizeCalculator (reduce size when depth is thin)
 *   - RiskChecker (reject when conditions are extreme)
 */

import { MarketSnapshot, MarketAnalysisConfig } from "../types";

/**
 * Default thresholds — conservative but not overly restrictive
 */
export const DEFAULT_MARKET_ANALYSIS_CONFIG: MarketAnalysisConfig = {
  wideSpreadThresholdBps: 200,   // 2% spread → adaptive mode
  maxSpreadBps: 800,             // 8% spread → reject trade
  maxDivergenceBps: 500,         // 5% divergence from trader → reject
  minDepthShares: 10,            // Need at least 10 shares near best price
  depthRangePercent: 0.01,       // Measure depth within 1% of best price
  stalePriceThresholdMs: 10_000, // 10 seconds = stale
};

export class MarketAnalyzer {
  private config: MarketAnalysisConfig;

  constructor(config: Partial<MarketAnalysisConfig> = {}) {
    this.config = { ...DEFAULT_MARKET_ANALYSIS_CONFIG, ...config };
  }

  /**
   * Build a full market snapshot from the order book.
   *
   * @param tokenId - The token to analyze
   * @param orderBook - Raw order book from the API
   * @param traderPrice - The price the trader executed at
   * @param targetSize - How many shares we intend to trade (for weighted price calc)
   * @returns A MarketSnapshot with all derived metrics
   */
  analyze(
    tokenId: string,
    orderBook: {
      bids: Array<{ price: string; size: string }>;
      asks: Array<{ price: string; size: string }>;
    },
    traderPrice: number,
    targetSize?: number
  ): MarketSnapshot {
    const now = new Date();
    const conditionReasons: string[] = [];

    // Parse and sort the book (single pass — no intermediate arrays)
    const asks: Array<{ price: number; size: number }> = [];
    for (const a of orderBook.asks) {
      const price = parseFloat(a.price);
      const size = parseFloat(a.size);
      if (price > 0 && size > 0) asks.push({ price, size });
    }
    asks.sort((a, b) => a.price - b.price); // Ascending (cheapest first)

    const bids: Array<{ price: number; size: number }> = [];
    for (const b of orderBook.bids) {
      const price = parseFloat(b.price);
      const size = parseFloat(b.size);
      if (price > 0 && size > 0) bids.push({ price, size });
    }
    bids.sort((a, b) => b.price - a.price); // Descending (highest first)

    // Best prices (fallback to trader price if book is empty)
    const bestAsk = asks.length > 0 ? asks[0].price : traderPrice;
    const bestBid = bids.length > 0 ? bids[0].price : traderPrice;
    const midpoint = (bestAsk + bestBid) / 2;

    // Spread
    const spread = bestAsk - bestBid;
    const spreadBps = midpoint > 0 ? (spread / midpoint) * 10000 : 0;

    // Depth near top of book (within depthRangePercent of best price)
    const askCeiling = bestAsk * (1 + this.config.depthRangePercent);
    const bidFloor = bestBid * (1 - this.config.depthRangePercent);

    let askDepthNear = 0;
    for (const a of asks) {
      if (a.price > askCeiling) break; // asks are sorted ascending
      askDepthNear += a.size;
    }

    let bidDepthNear = 0;
    for (const b of bids) {
      if (b.price < bidFloor) break; // bids are sorted descending
      bidDepthNear += b.size;
    }

    // Weighted average fill price for our target size
    const weightedAskForSize = targetSize
      ? this.calculateWeightedFill(asks, targetSize)
      : undefined;
    const weightedBidForSize = targetSize
      ? this.calculateWeightedFill(bids, targetSize)
      : undefined;

    // Divergence from trader's price
    const divergenceFromTrader = Math.abs(midpoint - traderPrice);
    const divergenceBps =
      traderPrice > 0
        ? (divergenceFromTrader / traderPrice) * 10000
        : 0;

    // Assess market condition
    let condition: MarketSnapshot["condition"] = "normal";
    let isVolatile = false;

    if (spreadBps > this.config.maxSpreadBps) {
      condition = "wide_spread";
      isVolatile = true;
      conditionReasons.push(
        `Spread ${spreadBps.toFixed(0)}bps exceeds max ${this.config.maxSpreadBps}bps`
      );
    } else if (spreadBps > this.config.wideSpreadThresholdBps) {
      condition = "wide_spread";
      isVolatile = true;
      conditionReasons.push(
        `Spread ${spreadBps.toFixed(0)}bps above threshold ${this.config.wideSpreadThresholdBps}bps`
      );
    }

    if (divergenceBps > this.config.maxDivergenceBps) {
      condition = "high_divergence";
      isVolatile = true;
      conditionReasons.push(
        `Divergence ${divergenceBps.toFixed(0)}bps from trader price exceeds max ${this.config.maxDivergenceBps}bps`
      );
    }

    if (askDepthNear < this.config.minDepthShares || bidDepthNear < this.config.minDepthShares) {
      if (condition === "normal") condition = "thin_book";
      isVolatile = true;
      conditionReasons.push(
        `Thin book: ask depth=${askDepthNear.toFixed(0)}, bid depth=${bidDepthNear.toFixed(0)} (min: ${this.config.minDepthShares})`
      );
    }

    if (asks.length === 0 && bids.length === 0) {
      condition = "stale";
      isVolatile = true;
      conditionReasons.push("Empty order book");
    }

    if (conditionReasons.length === 0) {
      conditionReasons.push("Normal market conditions");
    }

    return {
      tokenId,
      timestamp: now,
      bestAsk,
      bestBid,
      midpoint,
      spread,
      spreadBps,
      askDepthNear,
      bidDepthNear,
      weightedAskForSize,
      weightedBidForSize,
      divergenceFromTrader,
      divergenceBps,
      isVolatile,
      condition,
      conditionReasons,
    };
  }

  /**
   * Build a snapshot from just prices (fallback when order book fetch fails).
   * Less informative but still useful for divergence checks.
   */
  analyzeFromPrices(
    tokenId: string,
    bestAsk: number,
    bestBid: number,
    traderPrice: number
  ): MarketSnapshot {
    const midpoint = (bestAsk + bestBid) / 2;
    const spread = bestAsk - bestBid;
    const spreadBps = midpoint > 0 ? (spread / midpoint) * 10000 : 0;
    const divergenceFromTrader = Math.abs(midpoint - traderPrice);
    const divergenceBps = traderPrice > 0 ? (divergenceFromTrader / traderPrice) * 10000 : 0;

    const conditionReasons: string[] = [];
    let condition: MarketSnapshot["condition"] = "normal";
    let isVolatile = false;

    if (spreadBps > this.config.maxSpreadBps) {
      condition = "wide_spread";
      isVolatile = true;
      conditionReasons.push(
        `Spread ${spreadBps.toFixed(0)}bps exceeds max ${this.config.maxSpreadBps}bps`
      );
    } else if (spreadBps > this.config.wideSpreadThresholdBps) {
      condition = "wide_spread";
      isVolatile = true;
      conditionReasons.push(
        `Spread ${spreadBps.toFixed(0)}bps above threshold`
      );
    }

    if (divergenceBps > this.config.maxDivergenceBps) {
      condition = "high_divergence";
      isVolatile = true;
      conditionReasons.push(
        `Divergence ${divergenceBps.toFixed(0)}bps from trader price exceeds max`
      );
    }

    if (conditionReasons.length === 0) {
      conditionReasons.push("Normal (price-only analysis, no depth data)");
    }

    return {
      tokenId,
      timestamp: new Date(),
      bestAsk,
      bestBid,
      midpoint,
      spread,
      spreadBps,
      askDepthNear: 0,  // Unknown without book
      bidDepthNear: 0,
      divergenceFromTrader,
      divergenceBps,
      isVolatile,
      condition,
      conditionReasons,
    };
  }

  /**
   * Calculate the volume-weighted average price to fill a given size.
   *
   * Walks the order book levels until we've accumulated enough shares.
   * If the book can't fill our size, returns undefined.
   */
  private calculateWeightedFill(
    levels: Array<{ price: number; size: number }>,
    targetSize: number
  ): number | undefined {
    if (levels.length === 0 || targetSize <= 0) return undefined;

    let remaining = targetSize;
    let totalCost = 0;

    for (const level of levels) {
      const fillAtLevel = Math.min(remaining, level.size);
      totalCost += fillAtLevel * level.price;
      remaining -= fillAtLevel;

      if (remaining <= 0) break;
    }

    // If we couldn't fill entirely, return what we could get
    const filled = targetSize - Math.max(remaining, 0);
    if (filled <= 0) return undefined;

    return totalCost / filled;
  }

  /**
   * Get the recommended price for a given side based on the snapshot.
   *
   * For BUY: use best ask (or weighted ask if we have target size)
   * For SELL: use best bid (or weighted bid if we have target size)
   */
  getRecommendedPrice(
    snapshot: MarketSnapshot,
    side: "BUY" | "SELL"
  ): number {
    if (side === "BUY") {
      return snapshot.weightedAskForSize ?? snapshot.bestAsk;
    } else {
      return snapshot.weightedBidForSize ?? snapshot.bestBid;
    }
  }

  /**
   * Calculate what fraction of our target size the book can support
   * near the best price (depth ratio).
   *
   * Returns 1.0 if depth >= targetSize, scales down linearly otherwise.
   */
  getDepthRatio(
    snapshot: MarketSnapshot,
    side: "BUY" | "SELL",
    targetSize: number
  ): number {
    if (targetSize <= 0) return 1;
    const depth = side === "BUY" ? snapshot.askDepthNear : snapshot.bidDepthNear;
    return Math.min(1, depth / targetSize);
  }

  updateConfig(newConfig: Partial<MarketAnalysisConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): MarketAnalysisConfig {
    return { ...this.config };
  }
}
