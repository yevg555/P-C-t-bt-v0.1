/**
 * MARKET CONDITION CHECKER TESTS
 * ==============================
 * Tests for the MarketConditionChecker class that gates trades
 * based on spread, divergence, depth, and staleness.
 *
 * Run with: npx ts-node tests/market-condition-checker.test.ts
 */

import { MarketConditionChecker } from '../src/strategy/market-condition-checker';
import { MarketSnapshot, MarketAnalysisConfig } from '../src/types';
import { DEFAULT_MARKET_ANALYSIS_CONFIG } from '../src/strategy/market-analyzer';

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

// Helper: build a MarketSnapshot with given params
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
    conditionReasons: ['Normal'],
    ...overrides,
  };
}

const thresholds: MarketAnalysisConfig = {
  ...DEFAULT_MARKET_ANALYSIS_CONFIG,
};

// ================================================
console.log('\n🛡️  Testing MarketConditionChecker\n');
// ================================================

const checker = new MarketConditionChecker(thresholds);

// ----- Normal conditions -----

test('Approves normal market conditions', () => {
  const snap = makeSnapshot({ spreadBps: 100, divergenceBps: 50, condition: 'normal', isVolatile: false });
  const result = checker.check(snap);

  assert(result.approved, 'Should approve normal conditions');
  assert(result.riskLevel === 'low', `Risk should be low, got ${result.riskLevel}`);
});

// ----- Stale / empty book -----

test('Rejects stale market data', () => {
  const snap = makeSnapshot({ condition: 'stale', conditionReasons: ['Empty order book'] });
  const result = checker.check(snap);

  assert(!result.approved, 'Should reject stale data');
  assert(result.reason!.includes('stale'), `Reason should mention stale: "${result.reason}"`);
});

// ----- Max spread gate -----

test('Rejects when spread exceeds maxSpreadBps', () => {
  const snap = makeSnapshot({ spreadBps: 900 }); // > 800 default max
  const result = checker.check(snap);

  assert(!result.approved, 'Should reject wide spread');
  assert(result.reason!.includes('Spread too wide'), `Reason: "${result.reason}"`);
});

test('Approves when spread is just below maxSpreadBps', () => {
  const snap = makeSnapshot({ spreadBps: 790, condition: 'normal', isVolatile: false });
  const result = checker.check(snap);

  assert(result.approved, 'Should approve spread just below max');
});

// ----- Max divergence gate -----

test('Rejects when divergence exceeds maxDivergenceBps', () => {
  const snap = makeSnapshot({ divergenceBps: 600, spreadBps: 100 }); // > 500 default max
  const result = checker.check(snap);

  assert(!result.approved, 'Should reject high divergence');
  assert(result.reason!.includes('diverged too far'), `Reason: "${result.reason}"`);
});

test('Approves when divergence is below maxDivergenceBps', () => {
  const snap = makeSnapshot({
    divergenceBps: 400, spreadBps: 100, condition: 'normal', isVolatile: false,
  });
  const result = checker.check(snap);

  assert(result.approved, 'Should approve moderate divergence');
});

// ----- Thin book gate -----

test('Rejects when depth is below minDepthShares', () => {
  const snap = makeSnapshot({
    askDepthNear: 5,
    bidDepthNear: 3,
    spreadBps: 100,
    condition: 'normal',
    isVolatile: false,
  });
  // minDepthShares = 10 by default
  const result = checker.check(snap, 50);

  assert(!result.approved, 'Should reject thin book');
  assert(result.reason!.includes('too thin'), `Reason: "${result.reason}"`);
});

test('Approves when depth is above minDepthShares', () => {
  const snap = makeSnapshot({
    askDepthNear: 200,
    bidDepthNear: 150,
    spreadBps: 100,
    condition: 'normal',
    isVolatile: false,
  });
  const result = checker.check(snap, 50);

  assert(result.approved, 'Should approve sufficient depth');
});

// ----- Warning: order size > 50% of depth -----

test('Warns when order size exceeds 50% of depth', () => {
  const snap = makeSnapshot({
    askDepthNear: 60,
    bidDepthNear: 60,
    spreadBps: 100,
    condition: 'normal',
    isVolatile: false,
  });
  const result = checker.check(snap, 40); // 40/60 = 67%

  assert(result.approved, 'Should approve but warn');
  assert(result.warnings.length > 0, 'Should have warnings');
  assert(result.warnings.some(w => w.includes('slippage')), 'Should warn about slippage');
});

test('No slippage warning when order is small relative to depth', () => {
  const snap = makeSnapshot({
    askDepthNear: 200,
    bidDepthNear: 200,
    spreadBps: 100,
    condition: 'normal',
    isVolatile: false,
  });
  const result = checker.check(snap, 10); // 10/200 = 5%

  assert(result.warnings.every(w => !w.includes('slippage')), 'Should NOT warn about slippage');
});

// ----- Warning: wide spread (below max but above threshold) -----

test('Warns when spread exceeds wideSpreadThreshold but below max', () => {
  const snap = makeSnapshot({
    spreadBps: 500,
    condition: 'normal',
    isVolatile: false,
  }); // 500 > 200 threshold, < 800 max

  const result = checker.check(snap);

  assert(result.approved, 'Should approve but warn');
  assert(result.warnings.some(w => w.includes('Wide spread')), 'Should warn about wide spread');
});

// ----- Warning: moderate divergence -----

test('Warns when divergence exceeds 60% of max', () => {
  const snap = makeSnapshot({
    divergenceBps: 350,  // 350 > 500*0.6=300
    spreadBps: 100,
    condition: 'normal',
    isVolatile: false,
  });
  const result = checker.check(snap);

  assert(result.approved, 'Should approve but warn');
  assert(result.warnings.some(w => w.includes('divergence')), 'Should warn about divergence');
});

// ----- Risk level determination -----

test('Risk level is high when snapshot is volatile', () => {
  const snap = makeSnapshot({
    spreadBps: 500,
    isVolatile: true,
    condition: 'wide_spread',
  });
  const result = checker.check(snap);

  assert(result.approved, 'Should approve (below max)');
  assert(result.riskLevel === 'high', `Risk should be high, got ${result.riskLevel}`);
});

test('Risk level is medium with one warning', () => {
  const snap = makeSnapshot({
    spreadBps: 250,
    divergenceBps: 100,
    isVolatile: false,
    condition: 'normal',
  });
  const result = checker.check(snap);

  assert(result.approved, 'Should approve');
  assert(result.riskLevel === 'medium', `Risk should be medium, got ${result.riskLevel}`);
});

// ----- Custom thresholds -----

test('Custom thresholds are respected', () => {
  const strictThresholds: MarketAnalysisConfig = {
    ...DEFAULT_MARKET_ANALYSIS_CONFIG,
    maxSpreadBps: 200,        // Very strict
    maxDivergenceBps: 100,    // Very strict
    minDepthShares: 100,
  };

  // This would pass default thresholds but fail strict ones
  const snap = makeSnapshot({ spreadBps: 300, condition: 'normal' });
  // Instantiate new checker with strict thresholds
  const strictChecker = new MarketConditionChecker(strictThresholds);
  const result = strictChecker.check(snap);

  assert(!result.approved, 'Should reject with strict thresholds');
});

// ----- No order size: skips depth check -----

test('Skips depth check when no order size provided', () => {
  const snap = makeSnapshot({
    askDepthNear: 1,  // Very thin
    bidDepthNear: 1,
    spreadBps: 100,
    condition: 'normal',
    isVolatile: false,
  });
  // No orderSize parameter → depth check not run
  const result = checker.check(snap);

  assert(result.approved, 'Should approve without depth check');
});

// ================================================
// Summary
// ================================================
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('\n❌ Some tests failed!\n');
  process.exit(1);
} else {
  console.log('\n🎉 All MarketConditionChecker tests passed!\n');
}
