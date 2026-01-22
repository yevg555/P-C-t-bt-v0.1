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

  // === Spend Tracking Tests ===

  console.log("\n--- Spend Tracking Tests ---");

  await test("Tracks token spend correctly", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    // Buy 100 @ $0.50 = $50 spent on token-a
    await executor.execute(makeOrder("BUY", 100, 0.5, "token-a"));
    // Buy 50 @ $0.40 = $20 spent on token-a
    await executor.execute(makeOrder("BUY", 50, 0.4, "token-a"));

    const tokenSpend = executor.getTokenSpend("token-a");
    assertClose(tokenSpend, 70, 0.01, "Token spend should be $70");
  });

  await test("getSpendTracker returns all spend data", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 100, 0.5, "token-x"));
    await executor.execute(makeOrder("BUY", 50, 0.4, "token-y"));

    const tracker = executor.getSpendTracker();

    assert(tracker.tokenSpend.get("token-x") === 50, "Token X spend should be $50");
    assert(tracker.tokenSpend.get("token-y") === 20, "Token Y spend should be $20");
    assertClose(tracker.totalHoldingsValue, 70, 0.01, "Total holdings should be $70");
  });

  await test("Total holdings value updates correctly", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 100, 0.5, "token-holdings"));
    let tracker = executor.getSpendTracker();
    assertClose(tracker.totalHoldingsValue, 50, 0.01, "Holdings should be $50 after buy");

    // Sell half
    await executor.execute(makeOrder("SELL", 50, 0.6, "token-holdings"));
    tracker = executor.getSpendTracker();
    assertClose(tracker.totalHoldingsValue, 25, 0.01, "Holdings should be $25 after partial sell");
  });

  // === Position Details Tests ===

  console.log("\n--- Position Details Tests ---");

  await test("getAllPositionDetails returns full position info", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 100, 0.5, "token-details"));

    const positions = await executor.getAllPositionDetails();
    const position = positions.get("token-details");

    assert(position !== undefined, "Position should exist");
    assert(position!.quantity === 100, "Quantity should be 100");
    assert(position!.avgPrice === 0.5, "Avg price should be 0.5");
    assert(position!.entryPrice === 0.5, "Entry price should be 0.5");
    assert(position!.openedAt !== undefined, "Should have openedAt timestamp");
  });

  await test("Entry price stays constant when averaging in", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    // First buy
    await executor.execute(makeOrder("BUY", 100, 0.4, "token-entry"));
    const positions1 = await executor.getAllPositionDetails();
    const entryPrice1 = positions1.get("token-entry")!.entryPrice;

    // Second buy at different price
    await executor.execute(makeOrder("BUY", 100, 0.6, "token-entry"));
    const positions2 = await executor.getAllPositionDetails();
    const position = positions2.get("token-entry")!;

    // Entry price should stay the same (first trade price)
    assert(position.entryPrice === entryPrice1, "Entry price should not change");
    // But avg price should update
    assertClose(position.avgPrice, 0.5, 0.01, "Avg price should be average");
  });

  // === 1-Click Sell Tests ===

  console.log("\n--- 1-Click Sell Tests ---");

  await test("sellAllPositions sells all positions", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 100, 0.5, "token-1"));
    await executor.execute(makeOrder("BUY", 50, 0.4, "token-2"));
    await executor.execute(makeOrder("BUY", 75, 0.6, "token-3"));

    const prices = new Map<string, number>([
      ["token-1", 0.55],
      ["token-2", 0.45],
      ["token-3", 0.65],
    ]);

    const results = await executor.sellAllPositions(prices);

    assert(results.length === 3, `Expected 3 sell results, got ${results.length}`);
    assert(results.every(r => r.status === "filled"), "All should be filled");

    const positions = await executor.getAllPositions();
    assert(positions.size === 0, "All positions should be closed");
  });

  await test("sellAllPositions returns empty array when no positions", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    const results = await executor.sellAllPositions(new Map());

    assert(results.length === 0, "Should return empty array");
  });

  await test("sellAllPositions uses avgPrice as fallback when no price provided", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 1000 });

    await executor.execute(makeOrder("BUY", 100, 0.5, "token-fallback"));

    // Don't provide a price for the token
    const results = await executor.sellAllPositions(new Map());

    assert(results.length === 1, "Should have 1 result");
    assert(results[0].status === "filled", "Should be filled");
    assert(results[0].avgFillPrice === 0.5, "Should use avgPrice as fallback");
  });

  // === Reset Tests (extended) ===

  console.log("\n--- Reset Tests (extended) ---");

  await test("reset() clears spend tracker", async () => {
    const executor = new PaperTradingExecutor({ initialBalance: 500 });

    await executor.execute(makeOrder("BUY", 100, 0.5, "reset-spend"));

    const trackerBefore = executor.getSpendTracker();
    assert(trackerBefore.totalHoldingsValue > 0, "Should have holdings before reset");

    executor.reset();

    const trackerAfter = executor.getSpendTracker();
    assert(trackerAfter.totalHoldingsValue === 0, "Holdings should be 0 after reset");
    assert(trackerAfter.tokenSpend.size === 0, "Token spend should be cleared");
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
