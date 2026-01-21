/**
 * COPY SIZE CALCULATOR TESTS
 * ==========================
 * Run with: npx ts-node tests/copy-size.test.ts
 */

import { CopySizeCalculator } from '../src/strategy/copy-size';
import { PositionChange } from '../src/types';

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

// Helper to create a BUY change
function makeChange(delta: number, side: 'BUY' | 'SELL' = 'BUY'): PositionChange {
  return {
    tokenId: 'test-token',
    marketId: 'test-market',
    side,
    delta,
    previousQuantity: side === 'BUY' ? 0 : delta,
    currentQuantity: side === 'BUY' ? delta : 0,
    detectedAt: new Date(),
  };
}

// Helper to create a SELL change with specific previous/current quantities
function makeSellChange(delta: number, previousQty: number): PositionChange {
  return {
    tokenId: 'test-token',
    marketId: 'test-market',
    side: 'SELL',
    delta,
    previousQuantity: previousQty,
    currentQuantity: previousQty - delta,
    detectedAt: new Date(),
  };
}

console.log('\n📝 Testing CopySizeCalculator\n');

// ============================================
// BUY CALCULATION TESTS
// ============================================

console.log('--- BUY Calculations ---');

test('Proportional to portfolio: 5% of $1000 at $0.50', () => {
  const calc = new CopySizeCalculator({
    sizingMethod: 'proportional_to_portfolio',
    portfolioPercentage: 0.05,
    minOrderSize: 1,
  });

  const result = calc.calculate({
    change: makeChange(100),
    currentPrice: 0.50,
    yourBalance: 1000,
  });

  // 5% of $1000 = $50, at $0.50 per share = 100 shares
  assertClose(result.shares, 100, 1, 'Should calculate 100 shares');
  assertClose(result.estimatedCost, 50, 1, 'Cost should be ~$50');
  assert(result.side === 'BUY', 'Side should be BUY');
});

test('Proportional to portfolio: 10% of $500 at $0.25', () => {
  const calc = new CopySizeCalculator({
    sizingMethod: 'proportional_to_portfolio',
    portfolioPercentage: 0.10,
    minOrderSize: 1,
  });

  const result = calc.calculate({
    change: makeChange(200),
    currentPrice: 0.25,
    yourBalance: 500,
  });

  // 10% of $500 = $50, at $0.25 per share = 200 shares
  assertClose(result.shares, 200, 1, 'Should calculate 200 shares');
});

test('Caps at maxPositionPerToken', () => {
  const calc = new CopySizeCalculator({
    sizingMethod: 'proportional_to_portfolio',
    portfolioPercentage: 0.50, // 50% - very aggressive
    minOrderSize: 1,
    maxPositionPerToken: 100, // But cap at 100
  });

  const result = calc.calculate({
    change: makeChange(1000),
    currentPrice: 0.10,
    yourBalance: 10000,
  });

  // Would be 50000 shares without cap
  assert(result.shares === 100, `Should cap at 100, got ${result.shares}`);
  assert(result.adjustments.length > 0, 'Should have adjustment note');
});

test('Skips orders below minOrderSize', () => {
  const calc = new CopySizeCalculator({
    sizingMethod: 'proportional_to_portfolio',
    portfolioPercentage: 0.01, // 1%
    minOrderSize: 100,
  });

  const result = calc.calculate({
    change: makeChange(50),
    currentPrice: 0.50,
    yourBalance: 100, // 1% = $1, at $0.50 = 2 shares (below min)
  });

  assert(result.shares === 0, 'Should skip tiny order');
});

test('Rejects invalid price (0)', () => {
  const calc = new CopySizeCalculator();

  const result = calc.calculate({
    change: makeChange(100),
    currentPrice: 0,
    yourBalance: 1000,
  });

  assert(result.shares === 0, 'Should reject zero price');
  assert(result.reason.includes('Invalid price'), 'Should explain why');
});

test('Rejects invalid price (> 1)', () => {
  const calc = new CopySizeCalculator();

  const result = calc.calculate({
    change: makeChange(100),
    currentPrice: 1.5,
    yourBalance: 1000,
  });

  assert(result.shares === 0, 'Should reject price > 1');
});

test('Rejects zero balance', () => {
  const calc = new CopySizeCalculator();

  const result = calc.calculate({
    change: makeChange(100),
    currentPrice: 0.50,
    yourBalance: 0,
  });

  assert(result.shares === 0, 'Should reject zero balance');
  assert(result.reason.includes('No balance'), 'Should explain why');
});

test('Reduces to affordable amount if cost > balance', () => {
  const calc = new CopySizeCalculator({
    sizingMethod: 'proportional_to_portfolio',
    portfolioPercentage: 1.0, // 100% - try to spend everything
    minOrderSize: 1,
    maxPositionPerToken: 10000,
  });

  const result = calc.calculate({
    change: makeChange(1000),
    currentPrice: 0.50,
    yourBalance: 100, // Only $100
  });

  // At $0.50, can afford 200 shares max
  assert(result.shares <= 200, `Should cap at affordable: ${result.shares}`);
  assert(result.estimatedCost <= 100, `Cost should be <= balance: ${result.estimatedCost}`);
});

// ============================================
// SELL CALCULATION TESTS
// ============================================

console.log('\n--- SELL Calculations ---');

test('SELL proportional: trader sells 50%, you sell 50%', () => {
  const calc = new CopySizeCalculator({
    sellStrategy: 'proportional',
    minOrderSize: 1,
  });

  // Trader had 1000 shares, sold 500 (50%)
  const change = makeSellChange(500, 1000);

  const result = calc.calculate({
    change,
    currentPrice: 0.60,
    yourBalance: 1000,
    yourPosition: 100, // You have 100 shares
  });

  // You should sell 50% of 100 = 50 shares
  assertClose(result.shares, 50, 1, 'Should sell 50 shares (50% of position)');
  assert(result.side === 'SELL', 'Side should be SELL');
});

test('SELL proportional: trader sells 100% (closes position)', () => {
  const calc = new CopySizeCalculator({
    sellStrategy: 'proportional',
    minOrderSize: 1,
  });

  // Trader had 500 shares, sold all 500
  const change = makeSellChange(500, 500);

  const result = calc.calculate({
    change,
    currentPrice: 0.70,
    yourBalance: 500,
    yourPosition: 80,
  });

  // Trader sold 100%, you should sell 100% = 80 shares
  assertClose(result.shares, 80, 1, 'Should sell all 80 shares');
});

test('SELL full_exit: sells all when trader sells any', () => {
  const calc = new CopySizeCalculator({
    sellStrategy: 'full_exit',
    minOrderSize: 1,
  });

  // Trader had 1000, sold only 100 (10%)
  const change = makeSellChange(100, 1000);

  const result = calc.calculate({
    change,
    currentPrice: 0.50,
    yourBalance: 500,
    yourPosition: 200,
  });

  // Full exit = sell all your 200 shares
  assert(result.shares === 200, `Should sell all 200, got ${result.shares}`);
});

test('SELL match_delta: sells same number as trader', () => {
  const calc = new CopySizeCalculator({
    sellStrategy: 'match_delta',
    minOrderSize: 1,
  });

  // Trader sold 75 shares
  const change = makeSellChange(75, 500);

  const result = calc.calculate({
    change,
    currentPrice: 0.55,
    yourBalance: 500,
    yourPosition: 100, // You have 100
  });

  // Should sell 75 (same as trader)
  assert(result.shares === 75, `Should sell 75, got ${result.shares}`);
});

test('SELL match_delta: caps at your position', () => {
  const calc = new CopySizeCalculator({
    sellStrategy: 'match_delta',
    minOrderSize: 1,
  });

  // Trader sold 500 shares
  const change = makeSellChange(500, 1000);

  const result = calc.calculate({
    change,
    currentPrice: 0.55,
    yourBalance: 500,
    yourPosition: 100, // You only have 100
  });

  // Should cap at 100 (your position)
  assert(result.shares === 100, `Should cap at 100, got ${result.shares}`);
  assert(result.adjustments.some(a => a.includes('Capped')), 'Should note the cap');
});

test('SELL rejects when no position', () => {
  const calc = new CopySizeCalculator({
    sellStrategy: 'proportional',
    minOrderSize: 1,
  });

  const change = makeSellChange(100, 500);

  const result = calc.calculate({
    change,
    currentPrice: 0.50,
    yourBalance: 500,
    yourPosition: 0, // No position!
  });

  assert(result.shares === 0, 'Should return 0 with no position');
  assert(result.reason.includes('No position'), 'Should explain why');
});

test('SELL allows closing small position below minOrderSize', () => {
  const calc = new CopySizeCalculator({
    sellStrategy: 'full_exit',
    minOrderSize: 50, // High minimum
  });

  const change = makeSellChange(1000, 1000);

  const result = calc.calculate({
    change,
    currentPrice: 0.50,
    yourBalance: 500,
    yourPosition: 20, // Only 20 shares (below min)
  });

  // Should still allow closing the position
  assert(result.shares === 20, `Should allow closing 20 shares, got ${result.shares}`);
});

// ============================================
// shouldCopy TESTS
// ============================================

console.log('\n--- shouldCopy Tests ---');

test('shouldCopy returns true for BUY', () => {
  const calc = new CopySizeCalculator();
  const result = calc.shouldCopy(makeChange(100, 'BUY'));
  assert(result.copy === true, 'Should copy BUY');
});

test('shouldCopy returns true for SELL with position', () => {
  const calc = new CopySizeCalculator();
  const result = calc.shouldCopy(makeChange(100, 'SELL'), 50); // Has position
  assert(result.copy === true, 'Should copy SELL when has position');
});

test('shouldCopy returns false for SELL without position', () => {
  const calc = new CopySizeCalculator();
  const result = calc.shouldCopy(makeChange(100, 'SELL'), 0); // No position
  assert(result.copy === false, 'Should not copy SELL without position');
});

test('shouldCopy returns false for tiny changes', () => {
  const calc = new CopySizeCalculator();
  const result = calc.shouldCopy(makeChange(0.5, 'BUY'));
  assert(result.copy === false, 'Should not copy tiny change');
});

// ============================================
// ORDER CONFIG TESTS
// ============================================

console.log('\n--- Order Config Tests ---');

test('getOrderConfig returns configured values', () => {
  const calc = new CopySizeCalculator({
    orderType: 'limit',
    orderExpirationSeconds: 60,
    priceOffsetBps: 75,
  });

  const config = calc.getOrderConfig();

  assert(config.orderType === 'limit', 'Order type should be limit');
  assert(config.expirationSeconds === 60, 'Expiration should be 60s');
  assert(config.priceOffsetBps === 75, 'Price offset should be 75 bps');
});

test('getOrderConfig uses defaults', () => {
  const calc = new CopySizeCalculator({});

  const config = calc.getOrderConfig();

  assert(config.orderType === 'limit', 'Default order type should be limit');
  assert(config.expirationSeconds === 30, 'Default expiration should be 30s');
  assert(config.priceOffsetBps === 50, 'Default price offset should be 50 bps');
});

// === Summary ===

console.log('\n' + '─'.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(40));

if (failed > 0) {
  console.log('\n❌ Some tests failed!\n');
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!\n');
}
