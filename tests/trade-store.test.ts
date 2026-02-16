/**
 * TRADE STORE TESTS
 * =================
 * Tests for the SQLite trade history persistence layer
 */

import * as fs from "fs";
import * as path from "path";
import { TradeStore } from "../src/storage/trade-store";
import { OrderSpec, OrderResult } from "../src/types";

// Test results tracking
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e: unknown) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${(e as Error).message}`);
    failed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(actual: boolean, message: string) {
  if (!actual) {
    throw new Error(`${message}: expected true, got false`);
  }
}

// Use a temporary database for testing
const TEST_DB_DIR = path.join(process.cwd(), "data", "test");
const TEST_DB_PATH = path.join(TEST_DB_DIR, `test-${Date.now()}.db`);

function cleanup() {
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(TEST_DB_PATH + "-wal")) fs.unlinkSync(TEST_DB_PATH + "-wal");
    if (fs.existsSync(TEST_DB_PATH + "-shm")) fs.unlinkSync(TEST_DB_PATH + "-shm");
    if (fs.existsSync(TEST_DB_DIR)) fs.rmdirSync(TEST_DB_DIR);
  } catch {
    // Ignore cleanup errors
  }
}

function makeOrder(overrides: Partial<OrderSpec> = {}): OrderSpec {
  return {
    tokenId: "token-abc-123",
    side: "BUY",
    size: 100,
    price: 0.5,
    orderType: "limit",
    triggeredBy: {
      tokenId: "token-abc-123",
      marketId: "market-xyz",
      side: "BUY",
      delta: 100,
      previousQuantity: 0,
      currentQuantity: 100,
      detectedAt: new Date(),
      marketTitle: "Will it rain tomorrow?",
    },
    ...overrides,
  };
}

function makeResult(overrides: Partial<OrderResult> = {}): OrderResult {
  return {
    orderId: `ORDER-${Date.now()}`,
    status: "filled",
    filledSize: 100,
    avgFillPrice: 0.5,
    executedAt: new Date(),
    executionMode: "paper",
    orderType: "limit",
    ...overrides,
  };
}

export function runTradeStoreTests() {
  console.log("\n📝 Testing TradeStore\n");

  console.log("--- Database Initialization ---");

  test("Creates database and tables automatically", () => {
    const store = new TradeStore(TEST_DB_PATH);
    assertTrue(fs.existsSync(TEST_DB_PATH), "Database file exists");
    store.close();
  });

  console.log("\n--- Session Management ---");

  test("Starts a new session and returns ID", () => {
    const store = new TradeStore(TEST_DB_PATH);
    const sessionId = store.startSession({
      tradingMode: "paper",
      pollingMethod: "activity",
      traderAddress: "0xTrader123",
      startingBalance: 1000,
    });
    assertTrue(sessionId > 0, "Session ID is positive");
    assertEqual(store.getSessionId(), sessionId, "getSessionId matches");
    store.close();
  });

  test("Ends session with stats", () => {
    const store = new TradeStore(TEST_DB_PATH);
    store.startSession({
      tradingMode: "paper",
      pollingMethod: "activity",
      traderAddress: "0xTrader123",
      startingBalance: 1000,
    });
    store.endSession({
      pollsCompleted: 500,
      tradesDetected: 10,
      tradesExecuted: 8,
      totalPnl: 42.5,
      endingBalance: 1042.5,
    });

    const sessions = store.getSessions();
    assertTrue(sessions.length > 0, "Has sessions");
    const latest = sessions[0];
    assertEqual(latest.pollsCompleted, 500, "Polls completed");
    assertEqual(latest.tradesExecuted, 8, "Trades executed");
    assertEqual(latest.totalPnl, 42.5, "Total PnL");
    assertTrue(latest.endedAt !== undefined, "Has ended_at");
    store.close();
  });

  console.log("\n--- Trade Recording ---");

  test("Records a BUY trade", () => {
    const store = new TradeStore(TEST_DB_PATH);
    store.startSession({
      tradingMode: "paper",
      pollingMethod: "activity",
      traderAddress: "0xTrader123",
      startingBalance: 1000,
    });

    const tradeId = store.recordTrade({
      order: makeOrder(),
      result: makeResult(),
      traderAddress: "0xTrader123",
      traderPrice: 0.48,
      detectionLatencyMs: 150,
      executionLatencyMs: 50,
      totalLatencyMs: 200,
    });

    assertTrue(tradeId > 0, "Trade ID is positive");

    const trades = store.getTrades();
    assertTrue(trades.length > 0, "Has trades");
    const trade = trades[0];
    assertEqual(trade.side, "BUY", "Side is BUY");
    assertEqual(trade.size, 100, "Size is 100");
    assertEqual(trade.price, 0.5, "Price is 0.5");
    assertEqual(trade.status, "filled", "Status is filled");
    assertEqual(trade.executionMode, "paper", "Mode is paper");
    store.close();
  });

  test("Records a SELL trade with market title", () => {
    const store = new TradeStore(TEST_DB_PATH);
    store.startSession({
      tradingMode: "paper",
      pollingMethod: "activity",
      traderAddress: "0xTrader123",
      startingBalance: 1000,
    });

    store.recordTrade({
      order: makeOrder({ side: "SELL", price: 0.65 }),
      result: makeResult({ filledSize: 50, avgFillPrice: 0.65 }),
      traderAddress: "0xTrader123",
    });

    const trades = store.getTrades({ side: "SELL" });
    assertTrue(trades.length > 0, "Has SELL trades");
    assertEqual(trades[0].side, "SELL", "Side is SELL");
    store.close();
  });

  test("Updates trade P&L", () => {
    const store = new TradeStore(TEST_DB_PATH);
    store.startSession({
      tradingMode: "paper",
      pollingMethod: "activity",
      traderAddress: "0xTrader123",
      startingBalance: 1000,
    });

    const tradeId = store.recordTrade({
      order: makeOrder({ side: "SELL", price: 0.65 }),
      result: makeResult({ filledSize: 50, avgFillPrice: 0.65 }),
    });

    store.updateTradePnl(tradeId, 7.5);

    const trades = store.getTrades();
    const updated = trades.find(t => t.id === tradeId);
    assertTrue(updated !== undefined, "Trade found");
    assertEqual(updated!.pnl, 7.5, "P&L updated");
    store.close();
  });

  console.log("\n--- Querying ---");

  test("Filters trades by side", () => {
    const store = new TradeStore(TEST_DB_PATH);
    store.startSession({
      tradingMode: "paper",
      pollingMethod: "activity",
      traderAddress: "0xTrader123",
      startingBalance: 1000,
    });

    store.recordTrade({
      order: makeOrder({ side: "BUY" }),
      result: makeResult(),
    });
    store.recordTrade({
      order: makeOrder({ side: "SELL" }),
      result: makeResult(),
    });

    const buys = store.getTrades({ side: "BUY" });
    const sells = store.getTrades({ side: "SELL" });
    assertTrue(buys.length > 0, "Has BUY trades");
    assertTrue(sells.length > 0, "Has SELL trades");
    assertTrue(buys.every(t => t.side === "BUY"), "All filtered as BUY");
    assertTrue(sells.every(t => t.side === "SELL"), "All filtered as SELL");
    store.close();
  });

  test("Limits and offsets results", () => {
    const store = new TradeStore(TEST_DB_PATH);
    store.startSession({
      tradingMode: "paper",
      pollingMethod: "activity",
      traderAddress: "0xTrader123",
      startingBalance: 1000,
    });

    for (let i = 0; i < 5; i++) {
      store.recordTrade({
        order: makeOrder(),
        result: makeResult({ orderId: `ORDER-${i}` }),
      });
    }

    const limited = store.getTrades({ limit: 2 });
    assertEqual(limited.length, 2, "Limit works");

    const offset = store.getTrades({ limit: 2, offset: 2 });
    assertEqual(offset.length, 2, "Offset works");
    assertTrue(offset[0].orderId !== limited[0].orderId, "Different results with offset");
    store.close();
  });

  console.log("\n--- Performance Summary ---");

  test("Calculates performance summary", () => {
    const store = new TradeStore(TEST_DB_PATH);
    const sessionId = store.startSession({
      tradingMode: "paper",
      pollingMethod: "activity",
      traderAddress: "0xTrader123",
      startingBalance: 1000,
    });

    // Record some trades
    const buyId = store.recordTrade({
      order: makeOrder({ side: "BUY", price: 0.5 }),
      result: makeResult({ filledSize: 100, avgFillPrice: 0.5 }),
      totalLatencyMs: 200,
    });

    const sellId = store.recordTrade({
      order: makeOrder({ side: "SELL", price: 0.6 }),
      result: makeResult({ filledSize: 100, avgFillPrice: 0.6 }),
      totalLatencyMs: 150,
    });
    store.updateTradePnl(sellId, 10);

    const summary = store.getPerformanceSummary(sessionId);
    assertEqual(summary.totalTrades, 2, "Total trades");
    assertEqual(summary.buyCount, 1, "Buy count");
    assertEqual(summary.sellCount, 1, "Sell count");
    assertEqual(summary.totalPnl, 10, "Total PnL");
    assertEqual(summary.winCount, 1, "Win count");
    assertEqual(summary.lossCount, 0, "Loss count");
    assertEqual(summary.winRate, 1, "Win rate is 100%");
    store.close();
  });

  test("Returns empty summary when no trades", () => {
    const store = new TradeStore(TEST_DB_PATH);
    const sessionId = store.startSession({
      tradingMode: "paper",
      pollingMethod: "activity",
      traderAddress: "0xTrader123",
      startingBalance: 1000,
    });

    const summary = store.getPerformanceSummary(sessionId);
    assertEqual(summary.totalTrades, 0, "No trades");
    assertEqual(summary.winRate, 0, "Win rate is 0");
    store.close();
  });

  test("P&L by token groups correctly", () => {
    const store = new TradeStore(TEST_DB_PATH);
    const sessionId = store.startSession({
      tradingMode: "paper",
      pollingMethod: "activity",
      traderAddress: "0xTrader123",
      startingBalance: 1000,
    });

    const id1 = store.recordTrade({
      order: makeOrder({ tokenId: "token-A" }),
      result: makeResult(),
    });
    store.updateTradePnl(id1, 5);

    const id2 = store.recordTrade({
      order: makeOrder({ tokenId: "token-B" }),
      result: makeResult(),
    });
    store.updateTradePnl(id2, -3);

    const pnlByToken = store.getPnlByToken(sessionId);
    assertTrue(pnlByToken.length >= 2, "Has entries for both tokens");
    store.close();
  });

  test("getTradeCount returns correct count", () => {
    const store = new TradeStore(TEST_DB_PATH);
    const count = store.getTradeCount();
    assertTrue(count > 0, "Trade count is positive (across all tests)");
    store.close();
  });

  console.log("\n--- Sessions ---");

  test("getSessions returns session history", () => {
    const store = new TradeStore(TEST_DB_PATH);
    const sessions = store.getSessions();
    assertTrue(sessions.length > 0, "Has sessions from previous tests");
    assertTrue(sessions[0].startedAt !== undefined, "Has started_at");
    assertEqual(sessions[0].tradingMode, "paper", "Mode is paper");
    store.close();
  });

  // Cleanup
  cleanup();

  // Print results
  console.log("\n" + "─".repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("─".repeat(40));

  if (failed === 0) {
    console.log("\n🎉 All tests passed!\n");
  } else {
    console.log("\n❌ Some tests failed!\n");
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runTradeStoreTests();
}
