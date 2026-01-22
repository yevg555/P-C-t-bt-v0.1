/**
 * TP/SL MONITOR TESTS
 * ===================
 * Run with: npx ts-node tests/tp-sl-monitor.test.ts
 */

import { TpSlMonitor } from '../src/strategy/tp-sl-monitor';
import { PaperPosition } from '../src/types';

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

// Helper to create a position
function makePosition(
  tokenId: string,
  quantity: number,
  entryPrice: number,
  marketId?: string
): PaperPosition {
  return {
    tokenId,
    quantity,
    avgPrice: entryPrice,
    totalCost: quantity * entryPrice,
    entryPrice,
    marketId,
    openedAt: new Date(),
  };
}

console.log('\n📝 Testing TpSlMonitor\n');

// ============================================
// CONFIGURATION TESTS
// ============================================

console.log('--- Configuration Tests ---');

test('Disabled by default', () => {
  const monitor = new TpSlMonitor();
  const config = monitor.getConfig();
  assert(config.enabled === false, 'Should be disabled by default');
});

test('Can be enabled with config', () => {
  const monitor = new TpSlMonitor({ enabled: true });
  const config = monitor.getConfig();
  assert(config.enabled === true, 'Should be enabled');
});

test('Default TP is 10%', () => {
  const monitor = new TpSlMonitor();
  const config = monitor.getConfig();
  assertClose(config.takeProfitPercent!, 0.10, 0.001, 'Default TP should be 10%');
});

test('Default SL is 5%', () => {
  const monitor = new TpSlMonitor();
  const config = monitor.getConfig();
  assertClose(config.stopLossPercent!, 0.05, 0.001, 'Default SL should be 5%');
});

test('Can set custom TP/SL percentages', () => {
  const monitor = new TpSlMonitor({
    enabled: true,
    takeProfitPercent: 0.20,
    stopLossPercent: 0.08,
  });
  const config = monitor.getConfig();
  assertClose(config.takeProfitPercent!, 0.20, 0.001, 'TP should be 20%');
  assertClose(config.stopLossPercent!, 0.08, 0.001, 'SL should be 8%');
});

test('updateConfig updates settings', () => {
  const monitor = new TpSlMonitor({ enabled: false });
  monitor.updateConfig({ enabled: true, takeProfitPercent: 0.15 });
  const config = monitor.getConfig();
  assert(config.enabled === true, 'Should be enabled after update');
  assertClose(config.takeProfitPercent!, 0.15, 0.001, 'TP should be 15%');
});

// ============================================
// TAKE PROFIT TESTS
// ============================================

console.log('\n--- Take Profit Tests ---');

test('Triggers take profit when price rises above threshold', () => {
  const monitor = new TpSlMonitor({
    enabled: true,
    takeProfitPercent: 0.10, // 10%
    stopLossPercent: 0.05,
  });

  const positions = new Map<string, PaperPosition>();
  positions.set('token-tp', makePosition('token-tp', 100, 0.50)); // Entry @ $0.50

  // Price rose to $0.56 = 12% gain (above 10% TP)
  const prices = new Map<string, number>();
  prices.set('token-tp', 0.56);

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 1, `Expected 1 trigger, got ${triggers.length}`);
  assert(triggers[0].triggerType === 'take_profit', 'Should be take_profit');
  assert(triggers[0].tokenId === 'token-tp', 'Should be correct token');
  assertClose(triggers[0].percentChange, 0.12, 0.01, 'Percent change should be ~12%');
});

test('Does not trigger take profit below threshold', () => {
  const monitor = new TpSlMonitor({
    enabled: true,
    takeProfitPercent: 0.10,
    stopLossPercent: 0.05,
  });

  const positions = new Map<string, PaperPosition>();
  positions.set('token-tp', makePosition('token-tp', 100, 0.50));

  // Price rose to $0.54 = 8% gain (below 10% TP)
  const prices = new Map<string, number>();
  prices.set('token-tp', 0.54);

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 0, 'Should not trigger below threshold');
});

test('Triggers at exact threshold', () => {
  const monitor = new TpSlMonitor({
    enabled: true,
    takeProfitPercent: 0.10,
    stopLossPercent: 0.05,
  });

  const positions = new Map<string, PaperPosition>();
  positions.set('token-exact', makePosition('token-exact', 100, 0.50));

  // Price at exactly 10% gain
  const prices = new Map<string, number>();
  prices.set('token-exact', 0.55);

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 1, 'Should trigger at exact threshold');
  assert(triggers[0].triggerType === 'take_profit', 'Should be take_profit');
});

// ============================================
// STOP LOSS TESTS
// ============================================

console.log('\n--- Stop Loss Tests ---');

test('Triggers stop loss when price falls below threshold', () => {
  const monitor = new TpSlMonitor({
    enabled: true,
    takeProfitPercent: 0.10,
    stopLossPercent: 0.05, // 5%
  });

  const positions = new Map<string, PaperPosition>();
  positions.set('token-sl', makePosition('token-sl', 100, 0.50)); // Entry @ $0.50

  // Price dropped to $0.46 = 8% loss (above 5% SL)
  const prices = new Map<string, number>();
  prices.set('token-sl', 0.46);

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 1, `Expected 1 trigger, got ${triggers.length}`);
  assert(triggers[0].triggerType === 'stop_loss', 'Should be stop_loss');
  assert(triggers[0].tokenId === 'token-sl', 'Should be correct token');
  assertClose(triggers[0].percentChange, -0.08, 0.01, 'Percent change should be ~-8%');
});

test('Does not trigger stop loss above threshold', () => {
  const monitor = new TpSlMonitor({
    enabled: true,
    takeProfitPercent: 0.10,
    stopLossPercent: 0.05,
  });

  const positions = new Map<string, PaperPosition>();
  positions.set('token-sl', makePosition('token-sl', 100, 0.50));

  // Price dropped to $0.49 = 2% loss (below 5% SL)
  const prices = new Map<string, number>();
  prices.set('token-sl', 0.49);

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 0, 'Should not trigger above threshold');
});

// ============================================
// MULTIPLE POSITIONS TESTS
// ============================================

console.log('\n--- Multiple Positions Tests ---');

test('Checks multiple positions independently', () => {
  const monitor = new TpSlMonitor({
    enabled: true,
    takeProfitPercent: 0.10,
    stopLossPercent: 0.05,
  });

  const positions = new Map<string, PaperPosition>();
  positions.set('token-1', makePosition('token-1', 100, 0.50)); // Entry @ $0.50
  positions.set('token-2', makePosition('token-2', 50, 0.40));  // Entry @ $0.40
  positions.set('token-3', makePosition('token-3', 75, 0.60));  // Entry @ $0.60

  const prices = new Map<string, number>();
  prices.set('token-1', 0.56); // +12% -> TP
  prices.set('token-2', 0.36); // -10% -> SL
  prices.set('token-3', 0.62); // +3.3% -> No trigger

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 2, `Expected 2 triggers, got ${triggers.length}`);

  const tpTrigger = triggers.find(t => t.triggerType === 'take_profit');
  const slTrigger = triggers.find(t => t.triggerType === 'stop_loss');

  assert(tpTrigger !== undefined, 'Should have TP trigger');
  assert(tpTrigger!.tokenId === 'token-1', 'TP should be token-1');

  assert(slTrigger !== undefined, 'Should have SL trigger');
  assert(slTrigger!.tokenId === 'token-2', 'SL should be token-2');
});

// ============================================
// DISABLED TESTS
// ============================================

console.log('\n--- Disabled Monitor Tests ---');

test('Returns empty when disabled', () => {
  const monitor = new TpSlMonitor({ enabled: false });

  const positions = new Map<string, PaperPosition>();
  positions.set('token', makePosition('token', 100, 0.50));

  const prices = new Map<string, number>();
  prices.set('token', 0.70); // Would trigger TP if enabled

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 0, 'Should return no triggers when disabled');
});

// ============================================
// EDGE CASES
// ============================================

console.log('\n--- Edge Cases ---');

test('Handles missing price gracefully', () => {
  const monitor = new TpSlMonitor({ enabled: true });

  const positions = new Map<string, PaperPosition>();
  positions.set('token-no-price', makePosition('token-no-price', 100, 0.50));

  const prices = new Map<string, number>(); // Empty - no price

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 0, 'Should not trigger without price');
});

test('Handles missing entry price gracefully', () => {
  const monitor = new TpSlMonitor({ enabled: true });

  const positions = new Map<string, PaperPosition>();
  const posWithoutEntry: PaperPosition = {
    tokenId: 'token-no-entry',
    quantity: 100,
    avgPrice: 0.50,
    totalCost: 50,
    // No entryPrice!
  };
  positions.set('token-no-entry', posWithoutEntry);

  const prices = new Map<string, number>();
  prices.set('token-no-entry', 0.70);

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 0, 'Should not trigger without entry price');
});

test('Empty positions returns empty triggers', () => {
  const monitor = new TpSlMonitor({ enabled: true });

  const positions = new Map<string, PaperPosition>();
  const prices = new Map<string, number>();

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 0, 'Should return empty for empty positions');
});

// ============================================
// ORDER SPEC TESTS
// ============================================

console.log('\n--- Order Spec Tests ---');

test('Trigger includes correct order spec', () => {
  const monitor = new TpSlMonitor({
    enabled: true,
    takeProfitPercent: 0.10,
  });

  const positions = new Map<string, PaperPosition>();
  positions.set('token-order', makePosition('token-order', 100, 0.50));

  const prices = new Map<string, number>();
  prices.set('token-order', 0.60); // +20% -> TP

  const triggers = monitor.checkPositions(positions, prices);

  assert(triggers.length === 1, 'Should have 1 trigger');
  const order = triggers[0].order;

  assert(order.tokenId === 'token-order', 'Order should have correct tokenId');
  assert(order.side === 'SELL', 'Order should be SELL');
  assert(order.size === 100, 'Order size should match position');
  assert(order.price === 0.60, 'Order price should be current price');
  assert(order.orderType === 'market', 'Order type should be market');
});

// ============================================
// THRESHOLD INFO TESTS
// ============================================

console.log('\n--- Threshold Info Tests ---');

test('getThresholdInfo shows disabled state', () => {
  const monitor = new TpSlMonitor({ enabled: false });
  const info = monitor.getThresholdInfo();
  assert(info.includes('DISABLED'), 'Should show disabled');
});

test('getThresholdInfo shows enabled with thresholds', () => {
  const monitor = new TpSlMonitor({
    enabled: true,
    takeProfitPercent: 0.15,
    stopLossPercent: 0.08,
  });
  const info = monitor.getThresholdInfo();
  assert(info.includes('ENABLED'), 'Should show enabled');
  assert(info.includes('15.0%'), 'Should show TP percentage');
  assert(info.includes('8.0%'), 'Should show SL percentage');
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
