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

// Helper to create a change
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

console.log('\n📝 Testing CopySizeCalculator\n');

// === Basic Calculation Tests ===

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

// === shouldCopy Tests ===

test('shouldCopy returns true for BUY', () => {
  const calc = new CopySizeCalculator();
  const result = calc.shouldCopy(makeChange(100, 'BUY'));
  assert(result.copy === true, 'Should copy BUY');
});

test('shouldCopy returns false for SELL', () => {
  const calc = new CopySizeCalculator();
  const result = calc.shouldCopy(makeChange(100, 'SELL'));
  assert(result.copy === false, 'Should not copy SELL (not implemented)');
});

test('shouldCopy returns false for tiny changes', () => {
  const calc = new CopySizeCalculator();
  const result = calc.shouldCopy(makeChange(0.5, 'BUY'));
  assert(result.copy === false, 'Should not copy tiny change');
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
