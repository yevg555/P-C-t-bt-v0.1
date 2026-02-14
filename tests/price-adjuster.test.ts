/**
 * PRICE ADJUSTER TESTS (with adaptive mode)
 * ==========================================
 * Tests for the PriceAdjuster class — static offset, adaptive offset,
 * and edge cases.
 *
 * Run with: npx ts-node tests/price-adjuster.test.ts
 */

import { PriceAdjuster, adjustPrice, calculateSlippageCost } from '../src/strategy/price-adjuster';
import { MarketSnapshot } from '../src/types';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ~${expected}, got ${actual}`);
  }
}

// Helper: build a minimal MarketSnapshot with a given spread
function makeSnapshot(spreadBps: number): MarketSnapshot {
  const midpoint = 0.50;
  const halfSpread = (spreadBps / 10000) * midpoint / 2;
  return {
    tokenId: 'test',
    timestamp: new Date(),
    bestAsk: midpoint + halfSpread,
    bestBid: midpoint - halfSpread,
    midpoint,
    spread: halfSpread * 2,
    spreadBps,
    askDepthNear: 100,
    bidDepthNear: 100,
    divergenceFromTrader: 0,
    divergenceBps: 0,
    isVolatile: spreadBps > 200,
    condition: spreadBps > 200 ? 'wide_spread' : 'normal',
    conditionReasons: [],
  };
}

// ================================================
console.log('\n💰 Testing PriceAdjuster\n');
// ================================================

// ----- Static adjustPrice function -----

test('adjustPrice BUY adds offset', () => {
  // 50bps on $0.65 → $0.65 * 1.005 = $0.65325 → rounded to $0.6533
  const result = adjustPrice(0.65, 50, 'BUY');
  assertClose(result, 0.6533, 0.0001, 'BUY offset');
});

test('adjustPrice SELL subtracts offset', () => {
  // 50bps on $0.65 → $0.65 * 0.995 = $0.64675 → rounded to $0.6468
  const result = adjustPrice(0.65, 50, 'SELL');
  assertClose(result, 0.6468, 0.0001, 'SELL offset');
});

test('adjustPrice clamps to [0.01, 0.99]', () => {
  // Very high price + BUY offset shouldn't exceed 0.99
  const high = adjustPrice(0.99, 500, 'BUY');
  assert(high <= 0.99, `Should clamp at 0.99, got ${high}`);

  // Very low price + SELL offset shouldn't go below 0.01
  const low = adjustPrice(0.01, 500, 'SELL');
  assert(low >= 0.01, `Should clamp at 0.01, got ${low}`);
});

test('adjustPrice rounds to 4 decimal places', () => {
  const result = adjustPrice(0.3333, 33, 'BUY');
  const decimals = result.toString().split('.')[1]?.length || 0;
  assert(decimals <= 4, `Should have at most 4 decimal places, got ${decimals}`);
});

// ----- calculateSlippageCost -----

test('Slippage cost positive for BUY (paying more)', () => {
  const cost = calculateSlippageCost(100, 0.50, 0.5025);
  assertClose(cost, 0.25, 0.01, 'Extra cost for 100 shares');
});

test('Slippage cost negative for SELL (receiving less)', () => {
  const cost = calculateSlippageCost(100, 0.50, 0.4975);
  assertClose(cost, -0.25, 0.01, 'Less received for 100 shares');
});

// ----- PriceAdjuster class: static mode -----

test('PriceAdjuster.adjust uses default offset', () => {
  const pa = new PriceAdjuster(50);
  const result = pa.adjust(0.65, 'BUY');
  assertClose(result, 0.6533, 0.0001, 'Should match adjustPrice(0.65, 50, BUY)');
});

// ----- PriceAdjuster class: adaptive mode -----

test('Adaptive: uses base offset when spread is below threshold', () => {
  const pa = new PriceAdjuster(50, { adaptiveThresholdBps: 150 });
  const snapshot = makeSnapshot(100); // 100bps < 150bps threshold

  const { effectiveOffsetBps, adaptive } = pa.adjustAdaptive(0.50, 'BUY', snapshot);
  assert(!adaptive, 'Should NOT be in adaptive mode');
  assertClose(effectiveOffsetBps, 50, 0.1, 'Should use base offset');
});

test('Adaptive: scales offset when spread exceeds threshold', () => {
  const pa = new PriceAdjuster(50, {
    adaptiveThresholdBps: 150,
    spreadMultiplier: 0.5,
    maxAdaptiveOffsetBps: 300,
  });
  const snapshot = makeSnapshot(400); // 400bps > 150bps threshold

  const { effectiveOffsetBps, adaptive } = pa.adjustAdaptive(0.50, 'BUY', snapshot);
  assert(adaptive, 'Should be in adaptive mode');
  // 400 * 0.5 = 200, which is > base 50
  assertClose(effectiveOffsetBps, 200, 1, 'Should scale to 200bps');
});

test('Adaptive: caps at maxAdaptiveOffsetBps', () => {
  const pa = new PriceAdjuster(50, {
    adaptiveThresholdBps: 150,
    spreadMultiplier: 0.5,
    maxAdaptiveOffsetBps: 300,
  });
  const snapshot = makeSnapshot(800); // 800 * 0.5 = 400, but cap is 300

  const { effectiveOffsetBps } = pa.adjustAdaptive(0.50, 'BUY', snapshot);
  assertClose(effectiveOffsetBps, 300, 1, 'Should cap at 300bps');
});

test('Adaptive: base offset wins when spread*multiplier < base', () => {
  const pa = new PriceAdjuster(100, {
    adaptiveThresholdBps: 150,
    spreadMultiplier: 0.5,
    maxAdaptiveOffsetBps: 300,
  });
  // spread=160bps > threshold, 160*0.5=80 < base 100
  const snapshot = makeSnapshot(160);

  const { effectiveOffsetBps } = pa.adjustAdaptive(0.50, 'BUY', snapshot);
  assertClose(effectiveOffsetBps, 100, 1, 'Base 100 should win over 80');
});

test('Adaptive: adjustedPrice is correct for BUY', () => {
  const pa = new PriceAdjuster(50, {
    adaptiveThresholdBps: 150,
    spreadMultiplier: 0.5,
    maxAdaptiveOffsetBps: 300,
  });
  const snapshot = makeSnapshot(400);

  // effectiveOffset = 200bps
  // adjustedPrice = 0.50 * (1 + 200/10000) = 0.50 * 1.02 = 0.51
  const { adjustedPrice } = pa.adjustAdaptive(0.50, 'BUY', snapshot);
  assertClose(adjustedPrice, 0.51, 0.001, 'BUY adaptive price');
});

test('Adaptive: adjustedPrice is correct for SELL', () => {
  const pa = new PriceAdjuster(50, {
    adaptiveThresholdBps: 150,
    spreadMultiplier: 0.5,
    maxAdaptiveOffsetBps: 300,
  });
  const snapshot = makeSnapshot(400);

  // effectiveOffset = 200bps
  // adjustedPrice = 0.50 * (1 - 200/10000) = 0.50 * 0.98 = 0.49
  const { adjustedPrice } = pa.adjustAdaptive(0.50, 'SELL', snapshot);
  assertClose(adjustedPrice, 0.49, 0.001, 'SELL adaptive price');
});

// ----- getAdaptiveAdjustmentDetails logging -----

test('getAdaptiveAdjustmentDetails includes adaptive label in description', () => {
  const pa = new PriceAdjuster(50, { adaptiveThresholdBps: 150, spreadMultiplier: 0.5 });
  const snapshot = makeSnapshot(400);

  const details = pa.getAdaptiveAdjustmentDetails(0.50, 'BUY', 100, snapshot);
  assert(details.adaptive, 'Should be adaptive');
  assert(details.description.includes('ADAPTIVE'), `Description should mention ADAPTIVE: "${details.description}"`);
});

test('getAdaptiveAdjustmentDetails shows static for normal spread', () => {
  const pa = new PriceAdjuster(50, { adaptiveThresholdBps: 150 });
  const snapshot = makeSnapshot(50);

  const details = pa.getAdaptiveAdjustmentDetails(0.50, 'BUY', 100, snapshot);
  assert(!details.adaptive, 'Should not be adaptive');
  assert(details.description.includes('static'), `Description should mention static: "${details.description}"`);
});

// ================================================
// Summary
// ================================================
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('\n❌ Some tests failed!\n');
  process.exit(1);
} else {
  console.log('\n🎉 All PriceAdjuster tests passed!\n');
}
