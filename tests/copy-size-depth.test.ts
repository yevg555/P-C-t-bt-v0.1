/**
 * COPY SIZE CALCULATOR — DEPTH & EXPIRATION TESTS
 * ================================================
 * Tests for the new adjustForDepth() and getAdaptiveExpiration() methods.
 *
 * Run with: npx ts-node tests/copy-size-depth.test.ts
 */

import { CopySizeCalculator } from '../src/strategy/copy-size';
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

// Helper: build a MarketSnapshot with given depth
function makeSnapshot(overrides: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    tokenId: 'test-token',
    timestamp: new Date(),
    bestAsk: 0.51,
    bestBid: 0.49,
    midpoint: 0.50,
    spread: 0.02,
    spreadBps: 400,
    askDepthNear: 200,
    bidDepthNear: 150,
    divergenceFromTrader: 0,
    divergenceBps: 0,
    isVolatile: false,
    condition: 'normal',
    conditionReasons: [],
    ...overrides,
  };
}

// ================================================
console.log('\n📏 Testing CopySizeCalculator (depth + expiration)\n');
// ================================================

const calc = new CopySizeCalculator({ minOrderSize: 5 });

// ============================================================
// adjustForDepth
// ============================================================

test('No reduction when order fits within depth', () => {
  const snap = makeSnapshot({ askDepthNear: 200 });
  const result = calc.adjustForDepth(50, snap, 'BUY');

  assertClose(result.shares, 50, 0.01, 'Should keep 50 shares');
  assert(result.adjustment === undefined, 'No adjustment needed');
});

test('Reduces size when order exceeds depth (BUY)', () => {
  const snap = makeSnapshot({ askDepthNear: 40 });
  const result = calc.adjustForDepth(100, snap, 'BUY');

  // 80% of 40 = 32
  assertClose(result.shares, 32, 0.01, 'Should reduce to 80% of depth');
  assert(result.adjustment !== undefined, 'Should have adjustment reason');
  assert(result.adjustment!.includes('Reduced'), `Adjustment: "${result.adjustment}"`);
});

test('Reduces size when order exceeds depth (SELL)', () => {
  const snap = makeSnapshot({ bidDepthNear: 30 });
  const result = calc.adjustForDepth(100, snap, 'SELL');

  // 80% of 30 = 24
  assertClose(result.shares, 24, 0.01, 'Should reduce to 80% of bid depth');
  assert(result.adjustment !== undefined, 'Should have adjustment reason');
});

test('Uses BUY depth (askDepthNear) for BUY orders', () => {
  const snap = makeSnapshot({ askDepthNear: 50, bidDepthNear: 1000 });
  const result = calc.adjustForDepth(100, snap, 'BUY');

  // Should use askDepthNear=50, not bidDepthNear=1000
  assertClose(result.shares, 40, 0.01, 'Should use ask depth');
});

test('Uses SELL depth (bidDepthNear) for SELL orders', () => {
  const snap = makeSnapshot({ askDepthNear: 1000, bidDepthNear: 50 });
  const result = calc.adjustForDepth(100, snap, 'SELL');

  // Should use bidDepthNear=50, not askDepthNear=1000
  assertClose(result.shares, 40, 0.01, 'Should use bid depth');
});

test('Enforces minOrderSize as floor', () => {
  const snap = makeSnapshot({ askDepthNear: 3 }); // 80% of 3 = 2.4 < minOrderSize 5
  const result = calc.adjustForDepth(100, snap, 'BUY');

  assertClose(result.shares, 5, 0.01, 'Should enforce minOrderSize=5');
});

test('Returns 0 for 0 input shares', () => {
  const snap = makeSnapshot({ askDepthNear: 200 });
  const result = calc.adjustForDepth(0, snap, 'BUY');

  assertClose(result.shares, 0, 0.01, 'Should return 0');
});

test('Skips depth adjustment when depth is 0 (no data)', () => {
  const snap = makeSnapshot({ askDepthNear: 0 });
  const result = calc.adjustForDepth(100, snap, 'BUY');

  assertClose(result.shares, 100, 0.01, 'Should keep original size');
  assert(result.adjustment === undefined, 'No adjustment when no depth data');
});

test('Boundary: order exactly equals depth — no reduction', () => {
  const snap = makeSnapshot({ askDepthNear: 100 });
  const result = calc.adjustForDepth(100, snap, 'BUY');

  assertClose(result.shares, 100, 0.01, 'Order == depth, no reduction');
  assert(result.adjustment === undefined, 'No adjustment needed');
});

test('Boundary: order 1 share over depth — reduces', () => {
  const snap = makeSnapshot({ askDepthNear: 100 });
  const result = calc.adjustForDepth(101, snap, 'BUY');

  // 80% of 100 = 80
  assertClose(result.shares, 80, 0.01, 'Should reduce');
  assert(result.adjustment !== undefined, 'Should have adjustment');
});

// ============================================================
// getAdaptiveExpiration
// ============================================================

test('Normal market: keeps base expiration', () => {
  const snap = makeSnapshot({ isVolatile: false });
  const result = calc.getAdaptiveExpiration(snap, 30);

  assertClose(result.expirationSeconds, 30, 0, 'Should keep 30s');
  assert(result.reason === undefined, 'No reason needed');
});

test('Volatile market: halves expiration', () => {
  const snap = makeSnapshot({ isVolatile: true, condition: 'wide_spread' });
  const result = calc.getAdaptiveExpiration(snap, 30);

  assertClose(result.expirationSeconds, 15, 0, 'Should halve to 15s');
  assert(result.reason !== undefined, 'Should have reason');
  assert(result.reason!.includes('30s'), `Should mention original: "${result.reason}"`);
  assert(result.reason!.includes('15s'), `Should mention new: "${result.reason}"`);
});

test('Volatile market: minimum expiration is 5 seconds', () => {
  const snap = makeSnapshot({ isVolatile: true, condition: 'thin_book' });
  const result = calc.getAdaptiveExpiration(snap, 8);

  // 8 / 2 = 4, but min is 5
  assertClose(result.expirationSeconds, 5, 0, 'Should floor at 5s');
});

test('Volatile market: halves even large expirations', () => {
  const snap = makeSnapshot({ isVolatile: true, condition: 'high_divergence' });
  const result = calc.getAdaptiveExpiration(snap, 120);

  assertClose(result.expirationSeconds, 60, 0, 'Should halve 120 to 60s');
});

test('Non-volatile: no reason string returned', () => {
  const snap = makeSnapshot({ isVolatile: false });
  const result = calc.getAdaptiveExpiration(snap, 30);

  assert(result.reason === undefined, 'Should have no reason for non-volatile');
});

test('Volatile: reason includes condition type', () => {
  const snap = makeSnapshot({ isVolatile: true, condition: 'wide_spread' });
  const result = calc.getAdaptiveExpiration(snap, 30);

  assert(result.reason!.includes('wide_spread'), `Should mention condition: "${result.reason}"`);
});

// ============================================================
// Integration: adjustForDepth with real calculator output
// ============================================================

test('Integration: calculate then adjustForDepth', () => {
  const integrationCalc = new CopySizeCalculator({
    sizingMethod: 'proportional_to_portfolio',
    portfolioPercentage: 0.10,
    minOrderSize: 5,
  });

  // Balance $1000, price $0.50, 10% = $100 → 200 shares
  const sizeResult = integrationCalc.calculate({
    change: {
      tokenId: 'test-token', marketId: 'test-market', side: 'BUY',
      delta: 1000, previousQuantity: 0, currentQuantity: 1000, detectedAt: new Date(),
    },
    currentPrice: 0.50,
    yourBalance: 1000,
  });

  assert(sizeResult.shares > 100, `Should calculate ~200 shares, got ${sizeResult.shares}`);

  // Now the book only has 60 shares of depth
  const snap = makeSnapshot({ askDepthNear: 60 });
  const depthResult = integrationCalc.adjustForDepth(sizeResult.shares, snap, 'BUY');

  // 80% of 60 = 48
  assertClose(depthResult.shares, 48, 0.01, 'Should reduce to 48');
  assert(depthResult.adjustment !== undefined, 'Should explain the reduction');
});

// ================================================
// Summary
// ================================================
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('\n❌ Some tests failed!\n');
  process.exit(1);
} else {
  console.log('\n🎉 All CopySizeCalculator depth/expiration tests passed!\n');
}
