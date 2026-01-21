/**
 * PAPER TRADING EXECUTOR TESTS
 * ============================
 * Run with: npx ts-node tests/paper-executor.test.ts
 */

import { PaperTradingExecutor } from "../src/execution/paper-executor";
import { OrderSpec } from "../src/types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return (async () => {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`  ❌ ${name}`);
      console.log(`     Error: ${error}`);
      failed++;
    }
  })();
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message}: expected ~${expected}, got ${actual}`);
  }
}

// Helper to create an order
function makeOrder(
  side: "BUY" | "SELL",
  size: number,
  price: number,
  tokenId: string = "test-token-123"
): OrderSpec {
  return { tokenId, side, size, price };
}

async function runTests() {
  console.log("\n📝 Testing PaperTradingExecutor\n");

  // === Initialization Tests ===

  await test("Initializes with correct balance", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 5000 });
    const balance = await executor.getBalance();
    assert(balance === 5000, `Expected 5000, got ${balance}`);
  });

  await test("Defaults to $1000 balance", async () => {
    const executor = new PaperTradingExecutor();
    const balance = await executor.getBalance();
    assert(balance === 1000, `Expected 1000, got ${balance}`);
  });

  await test("Returns correct trading mode", async () => {
    const executor = new PaperTradingExecutor();
    assert(executor.getMode() === "paper", "Mode should be 'paper'");
  });

  await test("Is always ready", async () => {
    const executor = new PaperTradingExecutor();
    const ready = await executor.isReady();
    assert(ready === true, "Should always be ready");
  });

  // === Buy Order Tests ===

  await test("BUY order deducts from balance", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    const result = await executor.execute(makeOrder("BUY", 100, 0.5));

    assert(result.status === "filled", "Order should be filled");
    assert(result.filledSize === 100, `Expected 100 filled, got ${result.filledSize}`);

    const balance = await executor.getBalance();
    assertClose(balance, 950, 0.01, "Balance should be $950 after buying 100 @ $0.50");
  });

  await test("BUY order creates position", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 50, 0.25, "token-abc"));

    const position = await executor.getPosition("token-abc");
    assert(position === 50, `Expected position of 50, got ${position}`);
  });

  await test("BUY order averages into existing position", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    // Buy 100 @ $0.40
    await executor.execute(makeOrder("BUY", 100, 0.4, "token-xyz"));
    // Buy 100 @ $0.60
    await executor.execute(makeOrder("BUY", 100, 0.6, "token-xyz"));

    const position = await executor.getPosition("token-xyz");
    assert(position === 200, `Expected position of 200, got ${position}`);

    const details = executor.getPositionDetails("token-xyz");
    assertClose(details!.avgPrice, 0.5, 0.01, "Average price should be $0.50");
  });

  await test("BUY order fails when cannot afford even 1 share", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 0.5 });

    // Try to buy at $0.60 per share, but only have $0.50
    const result = await executor.execute(makeOrder("BUY", 100, 0.6));

    assert(result.status === "failed", "Order should fail");
    assert(result.error !== undefined && result.error.includes("Insufficient"), "Error should mention insufficient balance");
  });

  await test("BUY order partial fill when balance low", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 50 });

    // Try to buy 200 @ $0.50 = $100, but only have $50
    const result = await executor.execute(makeOrder("BUY", 200, 0.5));

    // Should fill 100 shares @ $0.50 = $50
    assert(result.status === "filled", "Order should partially fill");
    assert(result.filledSize === 100, `Expected 100 filled, got ${result.filledSize}`);

    const balance = await executor.getBalance();
    assertClose(balance, 0, 0.01, "Balance should be ~$0");
  });

  // === Sell Order Tests ===

  await test("SELL order adds to balance", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    // First buy
    await executor.execute(makeOrder("BUY", 100, 0.5, "token-sell"));
    const balanceAfterBuy = await executor.getBalance();

    // Then sell
    const result = await executor.execute(makeOrder("SELL", 50, 0.6, "token-sell"));

    assert(result.status === "filled", "Sell should fill");
    assert(result.filledSize === 50, `Expected 50 sold, got ${result.filledSize}`);

    const finalBalance = await executor.getBalance();
    // Started with $500 (after buy), sold 50 @ $0.60 = +$30
    assertClose(finalBalance, balanceAfterBuy + 30, 0.01, "Balance should increase by $30");
  });

  await test("SELL order reduces position", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 100, 0.5, "token-reduce"));
    await executor.execute(makeOrder("SELL", 40, 0.6, "token-reduce"));

    const position = await executor.getPosition("token-reduce");
    assert(position === 60, `Expected 60 remaining, got ${position}`);
  });

  await test("SELL order closes position when selling all", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 100, 0.5, "token-close"));
    await executor.execute(makeOrder("SELL", 100, 0.6, "token-close"));

    const position = await executor.getPosition("token-close");
    assert(position === 0, `Expected 0, got ${position}`);
  });

  await test("SELL order fails when no position", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    const result = await executor.execute(makeOrder("SELL", 50, 0.5, "no-position"));

    assert(result.status === "failed", "Should fail with no position");
    assert(result.error !== undefined && result.error.includes("No position"), "Error should mention no position");
  });

  await test("SELL order caps at available quantity", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 50, 0.5, "token-cap"));

    // Try to sell more than we have
    const result = await executor.execute(makeOrder("SELL", 100, 0.6, "token-cap"));

    assert(result.status === "filled", "Should fill partial");
    assert(result.filledSize === 50, `Expected 50 sold (capped), got ${result.filledSize}`);
  });

  // === P&L Tests ===

  await test("Tracks P&L correctly on profitable trade", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    // Buy 100 @ $0.50 = $50 cost
    await executor.execute(makeOrder("BUY", 100, 0.5, "profit-token"));

    // Sell 100 @ $0.70 = $70 proceeds, $20 profit
    await executor.execute(makeOrder("SELL", 100, 0.7, "profit-token"));

    const pnl = executor.getTotalPnL();
    assertClose(pnl, 20, 0.01, "P&L should be $20");
  });

  await test("Tracks P&L correctly on losing trade", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    // Buy 100 @ $0.60 = $60 cost
    await executor.execute(makeOrder("BUY", 100, 0.6, "loss-token"));

    // Sell 100 @ $0.40 = $40 proceeds, $20 loss
    await executor.execute(makeOrder("SELL", 100, 0.4, "loss-token"));

    const pnl = executor.getTotalPnL();
    assertClose(pnl, -20, 0.01, "P&L should be -$20");
  });

  // === Utility Tests ===

  await test("getAllPositions returns all positions", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 50, 0.3, "token-a"));
    await executor.execute(makeOrder("BUY", 75, 0.4, "token-b"));

    const positions = await executor.getAllPositions();

    assert(positions.size === 2, `Expected 2 positions, got ${positions.size}`);
    assert(positions.get("token-a") === 50, "Token A should have 50");
    assert(positions.get("token-b") === 75, "Token B should have 75");
  });

  await test("getTrades returns all trades", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 50, 0.3, "token-trades"));
    await executor.execute(makeOrder("SELL", 25, 0.4, "token-trades"));

    const trades = executor.getTrades();

    assert(trades.length === 2, `Expected 2 trades, got ${trades.length}`);
    assert(trades[0].side === "BUY", "First trade should be BUY");
    assert(trades[1].side === "SELL", "Second trade should be SELL");
  });

  await test("reset() clears all state", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 500 });

    await executor.execute(makeOrder("BUY", 100, 0.5, "reset-token"));

    executor.reset();

    const balance = await executor.getBalance();
    const position = await executor.getPosition("reset-token");
    const trades = executor.getTrades();

    assert(balance === 500, "Balance should reset to initial");
    assert(position === 0, "Position should be cleared");
    assert(trades.length === 0, "Trades should be cleared");
  });

  await test("getSummary returns correct stats", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 100, 0.5, "summary-token"));

    const summary = executor.getSummary();

    assert(summary.initialBalance === 1000, "Initial balance should be 1000");
    assert(summary.tradeCount === 1, "Should have 1 trade");
    assert(summary.positionCount === 1, "Should have 1 position");
  });

  // === Order Result Tests ===

  await test("Order result includes execution mode", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    const result = await executor.execute(makeOrder("BUY", 10, 0.5));

    assert(result.executionMode === "paper", "Mode should be 'paper'");
  });

  await test("Order result includes timestamp", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });
    const before = new Date();

    const result = await executor.execute(makeOrder("BUY", 10, 0.5));

    const after = new Date();
    assert(result.executedAt >= before, "Timestamp should be after start");
    assert(result.executedAt <= after, "Timestamp should be before end");
  });

  await test("Order result includes average fill price", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    const result = await executor.execute(makeOrder("BUY", 100, 0.65));

    assert(result.avgFillPrice === 0.65, `Expected 0.65, got ${result.avgFillPrice}`);
  });

  // === Summary ===
  console.log("\n" + "─".repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("─".repeat(40));

  if (failed > 0) {
    console.log("\n❌ Some tests failed!\n");
    process.exit(1);
  } else {
    console.log("\n🎉 All tests passed!\n");
  }
}

// Run tests
runTests();
