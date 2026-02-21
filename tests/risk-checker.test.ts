/**
 * RISK CHECKER TESTS
 * ==================
 * Tests for the core check() method that gates trades
 * based on P&L, balance, and position limits.
 *
 * Run with: npx ts-node tests/risk-checker.test.ts
 */

import { RiskChecker, TradingState } from '../src/strategy/risk-checker';
import { OrderSpec, SpendTracker, RiskConfig } from '../src/types';

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

// Helpers
function makeState(overrides: Partial<TradingState> = {}): TradingState {
  return {
    dailyPnL: 0,
    totalPnL: 0,
    balance: 1000,
    positions: new Map<string, number>(),
    totalShares: 0,
    spendTracker: {
        tokenSpend: new Map(),
        marketSpend: new Map(),
        totalHoldingsValue: 0
    },
    ...overrides,
  };
}

function makeOrder(overrides: Partial<OrderSpec> = {}): OrderSpec {
  return {
    tokenId: 'test-token',
    side: 'BUY',
    size: 10,
    price: 0.5,
    ...overrides,
  };
}

const defaultConfig: RiskConfig = {
    maxDailyLoss: 100,
    maxTotalLoss: 500,
    maxTokenSpend: 0,
    maxMarketSpend: 0,
    totalHoldingsLimit: 0,
};

// ================================================
console.log('\n🛡️  Testing RiskChecker.check\n');
// ================================================

// 1. Kill Switch
test('Rejects all trades when kill switch is active', () => {
    const checker = new RiskChecker(defaultConfig);
    checker.activateKillSwitch('Test kill switch');

    const result = checker.check(makeOrder(), makeState());

    assert(!result.approved, 'Should reject when kill switch is active');
    assert(result.reason!.includes('KILL SWITCH ACTIVE'), 'Reason should match');
});

// 2. Total Loss Limit
test('Rejects when total loss limit exceeded', () => {
    const checker = new RiskChecker(defaultConfig);
    const state = makeState({ totalPnL: -500 });

    const result = checker.check(makeOrder(), state);

    assert(!result.approved, 'Should reject when total loss limit exceeded');
    assert(result.reason!.includes('Total loss limit exceeded'), 'Reason should match');
    assert(checker.isKillSwitchOn(), 'Should activate kill switch');
});

// 3. Daily Loss Limit
test('Rejects when daily loss limit exceeded', () => {
    const checker = new RiskChecker(defaultConfig);
    const state = makeState({ dailyPnL: -100 });

    const result = checker.check(makeOrder(), state);

    assert(!result.approved, 'Should reject when daily loss limit exceeded');
    assert(result.reason!.includes('Daily loss limit exceeded'), 'Reason should match');
});

// 4. Balance Check
test('Rejects when insufficient balance for BUY', () => {
    const checker = new RiskChecker(defaultConfig);
    const state = makeState({ balance: 10 });
    const order = makeOrder({ side: 'BUY', size: 100, price: 0.5 }); // Cost: 50

    const result = checker.check(order, state);

    assert(!result.approved, 'Should reject insufficient balance');
    assert(result.reason!.includes('Insufficient balance'), 'Reason should match');
});

test('Approves SELL even with low balance', () => {
    const checker = new RiskChecker(defaultConfig);
    const state = makeState({ balance: 0, positions: new Map([['test-token', 100]]) });
    const order = makeOrder({ side: 'SELL', size: 10, price: 0.5 });

    const result = checker.check(order, state);

    assert(result.approved, 'Should approve SELL with low balance');
});

// 5. Spending Limits
test('Rejects when max token spend exceeded', () => {
    const config = { ...defaultConfig, maxTokenSpend: 100 };
    const checker = new RiskChecker(config);
    const tracker: SpendTracker = {
        tokenSpend: new Map([['test-token', 90]]),
        marketSpend: new Map(),
        totalHoldingsValue: 0
    };
    const state = makeState({ spendTracker: tracker });
    const order = makeOrder({ side: 'BUY', size: 40, price: 0.5 }); // Cost: 20. 90+20 = 110 > 100

    const result = checker.check(order, state);

    assert(!result.approved, 'Should reject max token spend');
    assert(result.reason!.includes('Max token spend exceeded'), 'Reason should match');
});

test('Rejects when max market spend exceeded', () => {
    const config = { ...defaultConfig, maxMarketSpend: 100 };
    const checker = new RiskChecker(config);
    const tracker: SpendTracker = {
        tokenSpend: new Map(),
        marketSpend: new Map([['market-1', 90]]),
        totalHoldingsValue: 0
    };
    const state = makeState({ spendTracker: tracker });
    const order = makeOrder({
        side: 'BUY',
        size: 40,
        price: 0.5,
        triggeredBy: {
            marketId: 'market-1',
            tokenId: 'test-token',
            side: 'BUY',
            delta: 40,
            previousQuantity: 0,
            currentQuantity: 40,
            detectedAt: new Date()
        }
    }); // Cost: 20. 90+20 = 110 > 100

    const result = checker.check(order, state);

    assert(!result.approved, 'Should reject max market spend');
    assert(result.reason!.includes('Max market spend exceeded'), 'Reason should match');
});

test('Rejects when total holdings limit exceeded', () => {
    const config = { ...defaultConfig, totalHoldingsLimit: 1000 };
    const checker = new RiskChecker(config);
    const tracker: SpendTracker = {
        tokenSpend: new Map(),
        marketSpend: new Map(),
        totalHoldingsValue: 990
    };
    const state = makeState({ spendTracker: tracker });
    const order = makeOrder({ side: 'BUY', size: 40, price: 0.5 }); // Cost: 20. 990+20 = 1010 > 1000

    const result = checker.check(order, state);

    assert(!result.approved, 'Should reject total holdings limit');
    assert(result.reason!.includes('Total holdings limit exceeded'), 'Reason should match');
});

// 6. Position Size Check (SELL)
test('Rejects SELL when not enough shares', () => {
    const checker = new RiskChecker(defaultConfig);
    const state = makeState({ positions: new Map([['test-token', 5]]) });
    const order = makeOrder({ side: 'SELL', size: 10, price: 0.5 });

    const result = checker.check(order, state);

    assert(!result.approved, 'Should reject SELL > held');
    assert(result.reason!.includes('Cannot sell'), 'Reason should match');
});

// 7. Warnings
test('Adds warning when approaching daily loss limit', () => {
    const checker = new RiskChecker(defaultConfig);
    const state = makeState({ dailyPnL: -80 }); // 80% of 100

    const result = checker.check(makeOrder(), state);

    assert(result.approved, 'Should approve but warn');
    assert(result.warnings.some(w => w.includes('Approaching daily loss limit')), 'Should have daily loss warning');
});

test('Adds warning when approaching total loss limit', () => {
    const checker = new RiskChecker(defaultConfig);
    const state = makeState({ totalPnL: -300 }); // 60% of 500

    const result = checker.check(makeOrder(), state);

    assert(result.approved, 'Should approve but warn');
    assert(result.warnings.some(w => w.includes('Approaching total loss limit')), 'Should have total loss warning');
});

test('Adds warning on low balance', () => {
    const checker = new RiskChecker(defaultConfig);
    const state = makeState({ balance: 40 });

    const result = checker.check(makeOrder(), state);

    assert(result.approved, 'Should approve but warn');
    assert(result.warnings.some(w => w.includes('Low balance')), 'Should have low balance warning');
});

test('Adds warning on large order', () => {
    const checker = new RiskChecker(defaultConfig);
    const state = makeState({ balance: 100 });
    const order = makeOrder({ side: 'BUY', size: 50, price: 1 }); // Cost 50 (50% of balance)

    const result = checker.check(order, state);

    assert(result.approved, 'Should approve but warn');
    assert(result.warnings.some(w => w.includes('Large order')), 'Should have large order warning');
});

// 8. Happy Path
test('Approves valid order with no warnings', () => {
    const checker = new RiskChecker(defaultConfig);
    const state = makeState();
    const order = makeOrder();

    const result = checker.check(order, state);

    assert(result.approved, 'Should approve valid order');
    assert(result.warnings.length === 0, 'Should have no warnings');
    assert(result.riskLevel === 'low', 'Risk level should be low');
});


// ================================================
// Summary
// ================================================
console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('\n❌ Some tests failed!\n');
  process.exit(1);
} else {
  console.log('\n🎉 All RiskChecker core tests passed!\n');
}
