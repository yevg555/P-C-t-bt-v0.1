/**
 * MARKET ANALYZER TESTS
 * =====================
 * Tests for the MarketAnalyzer class — order book analysis, spread,
 * depth, divergence, and market condition assessment.
 *
 * Run with: npx ts-node tests/market-analyzer.test.ts
 */

import { MarketAnalyzer } from '../src/strategy/market-analyzer';
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

// Helper: build a simple order book
function makeBook(
  asks: Array<[number, number]>,
  bids: Array<[number, number]>
) {
  return {
    asks: asks.map(([price, size]) => ({ price: price.toString(), size: size.toString() })),
    bids: bids.map(([price, size]) => ({ price: price.toString(), size: size.toString() })),
  };
}

// ================================================
console.log('\n📊 Testing MarketAnalyzer\n');
// ================================================

const analyzer = new MarketAnalyzer();

// ----- Basic snapshot from a healthy book -----

test('Normal market: correct bid/ask/spread', () => {
  const book = makeBook(
    [[0.6510, 500], [0.6520, 800], [0.6540, 1200]],
    [[0.6490, 400], [0.6480, 600], [0.6460, 900]]
  );
  const snap = analyzer.analyze('token-1', book, 0.65);

  assertClose(snap.bestAsk, 0.6510, 0.0001, 'bestAsk');
  assertClose(snap.bestBid, 0.6490, 0.0001, 'bestBid');
  assertClose(snap.midpoint, 0.6500, 0.0001, 'midpoint');
  assertClose(snap.spread, 0.0020, 0.0001, 'spread');
  // spreadBps = (0.002 / 0.65) * 10000 ≈ 30.8
  assert(snap.spreadBps > 25 && snap.spreadBps < 40, `spreadBps should be ~31, got ${snap.spreadBps}`);
});

test('Normal market: condition is "normal"', () => {
  const book = makeBook(
    [[0.6510, 500], [0.6520, 800]],
    [[0.6490, 400], [0.6480, 600]]
  );
  const snap = analyzer.analyze('token-1', book, 0.65);

  assert(snap.condition === 'normal', `Expected "normal", got "${snap.condition}"`);
  assert(!snap.isVolatile, 'Should not be volatile');
});

// ----- Depth calculation -----

test('Depth near best ask counts shares within 1%', () => {
  // Best ask = 0.50. 1% range = up to 0.505
  const book = makeBook(
    [[0.50, 100], [0.504, 200], [0.505, 50], [0.52, 1000]],
    [[0.49, 100]]
  );
  const snap = analyzer.analyze('token-1', book, 0.50);

  // $0.50, $0.504, $0.505 are within 1% (ceiling = 0.505)
  // $0.52 is NOT within 1%
  assertClose(snap.askDepthNear, 350, 1, 'askDepthNear');
});

test('Depth near best bid counts shares within 1%', () => {
  // Best bid = 0.70. 1% range = down to 0.693
  const book = makeBook(
    [[0.72, 100]],
    [[0.70, 50], [0.695, 80], [0.693, 20], [0.68, 500]]
  );
  const snap = analyzer.analyze('token-1', book, 0.70);

  // $0.70, $0.695, $0.693 are within 1% (floor = 0.693)
  // $0.68 is NOT within 1%
  assertClose(snap.bidDepthNear, 150, 1, 'bidDepthNear');
});

// ----- Weighted fill price -----

test('Weighted fill price walks the book correctly', () => {
  // Asks: 100 @ $0.50, 200 @ $0.52
  // To fill 150 shares: 100 @ $0.50 + 50 @ $0.52
  // Weighted = (100*0.50 + 50*0.52) / 150 = (50 + 26) / 150 = 0.5067
  const book = makeBook(
    [[0.50, 100], [0.52, 200]],
    [[0.48, 100]]
  );
  const snap = analyzer.analyze('token-1', book, 0.50, 150);

  assert(snap.weightedAskForSize !== undefined, 'weightedAskForSize should exist');
  assertClose(snap.weightedAskForSize!, 0.5067, 0.001, 'weightedAskForSize');
});

test('Weighted fill when book can fully fill', () => {
  // All 50 shares fill at first level ($0.60)
  const book = makeBook(
    [[0.60, 200], [0.62, 300]],
    [[0.58, 100]]
  );
  const snap = analyzer.analyze('token-1', book, 0.60, 50);

  assert(snap.weightedAskForSize !== undefined, 'should exist');
  assertClose(snap.weightedAskForSize!, 0.60, 0.001, 'Should fill at best ask');
});

// ----- Divergence -----

test('Divergence calculated correctly', () => {
  const book = makeBook(
    [[0.60, 100]],
    [[0.58, 100]]
  );
  // Trader bought at $0.55, midpoint is now $0.59
  // Divergence = |0.59 - 0.55| = 0.04
  // DivergenceBps = (0.04 / 0.55) * 10000 ≈ 727
  const snap = analyzer.analyze('token-1', book, 0.55);

  assertClose(snap.divergenceFromTrader, 0.04, 0.001, 'divergence');
  assert(snap.divergenceBps > 700 && snap.divergenceBps < 750,
    `divergenceBps should be ~727, got ${snap.divergenceBps}`);
});

test('No divergence when midpoint equals trader price', () => {
  const book = makeBook(
    [[0.51, 100]],
    [[0.49, 100]]
  );
  const snap = analyzer.analyze('token-1', book, 0.50);

  assertClose(snap.divergenceFromTrader, 0, 0.001, 'Should be zero divergence');
});

// ----- Wide spread detection -----

test('Wide spread detected above threshold', () => {
  // Spread: $0.55 - $0.45 = $0.10, midpoint = $0.50
  // SpreadBps = (0.10 / 0.50) * 10000 = 2000bps
  const book = makeBook(
    [[0.55, 100]],
    [[0.45, 100]]
  );
  const snap = analyzer.analyze('token-1', book, 0.50);

  assert(snap.condition === 'wide_spread', `Expected "wide_spread", got "${snap.condition}"`);
  assert(snap.isVolatile, 'Should be volatile');
  assertClose(snap.spreadBps, 2000, 50, 'spreadBps');
});

// ----- High divergence detection -----

test('High divergence condition detected', () => {
  // Midpoint ~$0.70, trader price $0.55
  // Divergence = 0.15 / 0.55 * 10000 ≈ 2727bps
  const narrowBook = makeBook(
    [[0.7010, 100]],
    [[0.6990, 100]]
  );
  const snap = analyzer.analyze('token-1', narrowBook, 0.55);

  assert(snap.condition === 'high_divergence', `Expected "high_divergence", got "${snap.condition}"`);
  assert(snap.divergenceBps > 2500, `divergenceBps should be >2500, got ${snap.divergenceBps}`);
});

// ----- Thin book detection -----

test('Thin book detected when depth below minimum', () => {
  const thinAnalyzer = new MarketAnalyzer({ minDepthShares: 50 });
  // Narrow spread so wide_spread doesn't trigger first
  const book = makeBook(
    [[0.501, 5], [0.502, 3]],  // Only 8 shares on ask side
    [[0.499, 2]]                // Only 2 shares on bid side
  );
  const snap = thinAnalyzer.analyze('token-1', book, 0.50);

  assert(snap.condition === 'thin_book', `Expected "thin_book", got "${snap.condition}"`);
  assert(snap.isVolatile, 'Thin book should be volatile');
});

// ----- Empty book -----

test('Empty book returns stale condition', () => {
  const book = makeBook([], []);
  const snap = analyzer.analyze('token-1', book, 0.50);

  assert(snap.condition === 'stale', `Expected "stale", got "${snap.condition}"`);
  assert(snap.isVolatile, 'Empty book should be volatile');
});

// ----- analyzeFromPrices fallback -----

test('analyzeFromPrices builds snapshot without depth', () => {
  const snap = analyzer.analyzeFromPrices('token-1', 0.65, 0.63, 0.64);

  assertClose(snap.bestAsk, 0.65, 0.0001, 'bestAsk');
  assertClose(snap.bestBid, 0.63, 0.0001, 'bestBid');
  assertClose(snap.midpoint, 0.64, 0.0001, 'midpoint');
  assert(snap.askDepthNear === 0, 'No depth data in price-only mode');
  assert(snap.bidDepthNear === 0, 'No depth data in price-only mode');
});

// ----- getRecommendedPrice -----

test('getRecommendedPrice uses best ask for BUY', () => {
  const book = makeBook(
    [[0.60, 200]],
    [[0.58, 100]]
  );
  const snap = analyzer.analyze('token-1', book, 0.59);
  const price = analyzer.getRecommendedPrice(snap, 'BUY');
  assertClose(price, 0.60, 0.001, 'Should recommend best ask');
});

test('getRecommendedPrice uses best bid for SELL', () => {
  const book = makeBook(
    [[0.60, 200]],
    [[0.58, 100]]
  );
  const snap = analyzer.analyze('token-1', book, 0.59);
  const price = analyzer.getRecommendedPrice(snap, 'SELL');
  assertClose(price, 0.58, 0.001, 'Should recommend best bid');
});

test('getRecommendedPrice uses weighted ask when target size provided', () => {
  const book = makeBook(
    [[0.50, 100], [0.52, 200]],
    [[0.48, 100]]
  );
  const snap = analyzer.analyze('token-1', book, 0.50, 150);
  const price = analyzer.getRecommendedPrice(snap, 'BUY');

  // Weighted = (100*0.50 + 50*0.52) / 150 ≈ 0.5067
  assertClose(price, 0.5067, 0.001, 'Should recommend weighted ask');
});

// ----- getDepthRatio -----

test('getDepthRatio returns 1.0 when depth exceeds target', () => {
  const book = makeBook(
    [[0.60, 200]],
    [[0.58, 100]]
  );
  const snap = analyzer.analyze('token-1', book, 0.59);
  const ratio = analyzer.getDepthRatio(snap, 'BUY', 50);
  assertClose(ratio, 1.0, 0.01, 'Depth > target, ratio should be 1.0');
});

test('getDepthRatio scales down when depth is insufficient', () => {
  const book = makeBook(
    [[0.60, 40]],
    [[0.58, 100]]
  );
  const snap = analyzer.analyze('token-1', book, 0.59);
  const ratio = analyzer.getDepthRatio(snap, 'BUY', 100);
  // 40 / 100 = 0.4
  assertClose(ratio, 0.4, 0.01, 'Should scale to 0.4');
});

// ================================================
// Summary
// ================================================
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('\n❌ Some tests failed!\n');
  process.exit(1);
} else {
  console.log('\n🎉 All MarketAnalyzer tests passed!\n');
}
