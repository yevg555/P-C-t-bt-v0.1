/**
 * SLIPPAGE GUARD
 * ==============
 * Validates that fill prices don't deviate too far from expected prices.
 * Protects against front-running and adverse market moves.
 */

export interface SlippageCheckResult {
  /** Whether the fill is acceptable */
  acceptable: boolean;
  /** Actual slippage in basis points */
  slippageBps: number;
  /** Human-readable description */
  description: string;
}

/**
 * Check if a fill price is within acceptable slippage from the expected price.
 *
 * @param side - BUY or SELL
 * @param expectedPrice - The price we expected to fill at
 * @param fillPrice - The actual fill price
 * @param maxSlippageBps - Maximum acceptable slippage in basis points (default: 200 = 2%)
 */
export function checkSlippage(
  side: "BUY" | "SELL",
  expectedPrice: number,
  fillPrice: number,
  maxSlippageBps: number = 200,
): SlippageCheckResult {
  if (expectedPrice <= 0) {
    return { acceptable: true, slippageBps: 0, description: "No expected price to compare" };
  }

  const priceDiff = fillPrice - expectedPrice;

  // For BUY: paying more than expected = negative slippage
  // For SELL: receiving less than expected = negative slippage
  const adverseMove = side === "BUY" ? priceDiff : -priceDiff;
  const slippageBps = Math.round((adverseMove / expectedPrice) * 10000);

  if (slippageBps <= maxSlippageBps) {
    return {
      acceptable: true,
      slippageBps,
      description: slippageBps <= 0
        ? `Price improvement: ${Math.abs(slippageBps)}bps better than expected`
        : `Slippage: ${slippageBps}bps (within ${maxSlippageBps}bps limit)`,
    };
  }

  return {
    acceptable: false,
    slippageBps,
    description: `Excessive slippage: ${slippageBps}bps exceeds ${maxSlippageBps}bps limit (expected $${expectedPrice.toFixed(4)}, got $${fillPrice.toFixed(4)})`,
  };
}
