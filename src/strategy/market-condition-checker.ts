import { MarketSnapshot, MarketAnalysisConfig } from '../types';
import { RiskCheckResult } from './risk-checker';

export class MarketConditionChecker {
  private config: MarketAnalysisConfig;

  constructor(config: MarketAnalysisConfig) {
    this.config = config;
  }

  /**
   * Check market conditions from a MarketSnapshot.
   * This is a separate check that runs BEFORE the standard risk check.
   *
   * Returns rejection reasons for:
   *   - Spread too wide (exceeds maxSpreadBps)
   *   - Price diverged too far from trader's fill
   *   - Order book is empty / stale
   *   - Depth too thin for our order size
   */
  check(
    snapshot: MarketSnapshot,
    orderSize?: number
  ): RiskCheckResult {
    const warnings: string[] = [];
    const thresholds = this.config;

    // === STALE / EMPTY BOOK ===
    if (snapshot.condition === "stale") {
      return {
        approved: false,
        reason: `Market data is stale or book is empty: ${snapshot.conditionReasons.join("; ")}`,
        warnings: [],
        riskLevel: "high",
      };
    }

    // === MAX SPREAD GATE (hard reject) ===
    if (snapshot.spreadBps > thresholds.maxSpreadBps) {
      return {
        approved: false,
        reason: `Spread too wide: ${snapshot.spreadBps.toFixed(0)}bps > max ${thresholds.maxSpreadBps}bps (${snapshot.bestBid.toFixed(4)} / ${snapshot.bestAsk.toFixed(4)})`,
        warnings: [],
        riskLevel: "high",
      };
    }

    // === MAX DIVERGENCE GATE (hard reject) ===
    if (snapshot.divergenceBps > thresholds.maxDivergenceBps) {
      return {
        approved: false,
        reason: `Price diverged too far from trader: ${snapshot.divergenceBps.toFixed(0)}bps > max ${thresholds.maxDivergenceBps}bps (mid: $${snapshot.midpoint.toFixed(4)})`,
        warnings: [],
        riskLevel: "high",
      };
    }

    // === THIN BOOK WARNING / REJECT ===
    if (orderSize && orderSize > 0) {
      const relevantDepth = Math.max(snapshot.askDepthNear, snapshot.bidDepthNear);
      if (relevantDepth < thresholds.minDepthShares) {
        return {
          approved: false,
          reason: `Book too thin: ${relevantDepth.toFixed(0)} shares available near best price (need ${thresholds.minDepthShares})`,
          warnings: [],
          riskLevel: "high",
        };
      }

      // Warn if our order is > 50% of available depth
      if (relevantDepth > 0 && orderSize > relevantDepth * 0.5) {
        warnings.push(
          `Order size (${orderSize.toFixed(0)}) is ${((orderSize / relevantDepth) * 100).toFixed(0)}% of near depth (${relevantDepth.toFixed(0)} shares) — may cause slippage`
        );
      }
    }

    // === WIDE SPREAD WARNING (not a reject, just a flag) ===
    if (snapshot.spreadBps > thresholds.wideSpreadThresholdBps) {
      warnings.push(
        `Wide spread: ${snapshot.spreadBps.toFixed(0)}bps (threshold: ${thresholds.wideSpreadThresholdBps}bps) — adaptive offset engaged`
      );
    }

    // === DIVERGENCE WARNING ===
    if (snapshot.divergenceBps > thresholds.maxDivergenceBps * 0.6) {
      warnings.push(
        `Moderate divergence: ${snapshot.divergenceBps.toFixed(0)}bps from trader's price`
      );
    }

    // Determine risk level
    let riskLevel: "low" | "medium" | "high" = "low";
    if (snapshot.isVolatile || warnings.length > 1) {
      riskLevel = "high";
    } else if (warnings.length > 0) {
      riskLevel = "medium";
    }

    return {
      approved: true,
      warnings,
      riskLevel,
    };
  }
}
