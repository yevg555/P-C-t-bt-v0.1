/**
 * EXECUTOR FACTORY TESTS
 * ======================
 * Run with: npx ts-node tests/executor-factory.test.ts
 */

import { createExecutor, createPaperExecutor, createLiveExecutor, getTradingMode, isPaperTrading, isLiveTrading } from "../src/execution/executor-factory";
import { PaperTradingExecutor } from "../src/execution/paper-executor";
import { LiveTradingExecutor } from "../src/execution/live-executor";

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

function assertThrows(fn: () => void, errorMsgIncludes: string) {
  try {
    fn();
    throw new Error("Expected function to throw, but it did not.");
  } catch (error: any) {
    if (!error.message.includes(errorMsgIncludes)) {
      throw new Error(`Expected error to include "${errorMsgIncludes}", got "${error.message}"`);
    }
  }
}

async function runTests() {
  console.log("\n📝 Testing ExecutorFactory\n");

  const originalEnv = { ...process.env };

  const resetEnv = () => {
    process.env = { ...originalEnv };
    delete process.env.TRADING_MODE;
    delete process.env.MY_PRIVATE_KEY;
    delete process.env.FUNDER_ADDRESS;
    delete process.env.PAPER_TRADING_BALANCE;
  };

  // === Default Behavior ===

  await test("Defaults to paper executor when no config", () => {
    resetEnv();
    const executor = createExecutor();
    assert(executor instanceof PaperTradingExecutor, "Should be PaperTradingExecutor");
    assert(executor.getMode() === "paper", "Mode should be paper");
  });

  await test("Respects TRADING_MODE=paper", () => {
    resetEnv();
    process.env.TRADING_MODE = "paper";
    const executor = createExecutor();
    assert(executor instanceof PaperTradingExecutor, "Should be PaperTradingExecutor");
  });

  await test("Respects TRADING_MODE=live (fails without keys)", () => {
    resetEnv();
    process.env.TRADING_MODE = "live";
    // Should fail because keys are missing
    assertThrows(() => createExecutor(), "Live trading requires private key");
  });

  await test("Falls back to paper on invalid mode", () => {
    resetEnv();
    process.env.TRADING_MODE = "invalid_mode";
    const executor = createExecutor();
    assert(executor instanceof PaperTradingExecutor, "Should fallback to PaperTradingExecutor");
  });

  // === Overrides ===

  await test("Override mode takes precedence over env", () => {
    resetEnv();
    process.env.TRADING_MODE = "live";
    // Even though env says live (which would fail without keys), we override to paper
    const executor = createExecutor({ mode: "paper" });
    assert(executor instanceof PaperTradingExecutor, "Should use override mode");
  });

  // === Paper Executor Configuration ===

  await test("Paper executor uses default balance", async () => {
    resetEnv();
    const executor = createPaperExecutor();
    assert((await executor.getBalance()) === 1000, "Default balance should be 1000");
  });

  await test("Paper executor uses env var balance", async () => {
    resetEnv();
    process.env.PAPER_TRADING_BALANCE = "5000";
    const executor = createPaperExecutor();
    assert((await executor.getBalance()) === 5000, "Should use env var balance");
  });

  await test("Paper executor uses argument balance", async () => {
    resetEnv();
    process.env.PAPER_TRADING_BALANCE = "5000";
    const executor = createPaperExecutor(2000);
    assert((await executor.getBalance()) === 2000, "Argument should override env var");
  });

  // === Live Executor Configuration ===

  await test("Live executor creation fails without private key", () => {
    resetEnv();
    assertThrows(() => createLiveExecutor(), "Live trading requires private key");
  });

  await test("Live executor creation fails without funder address", () => {
    resetEnv();
    process.env.MY_PRIVATE_KEY = "0x123";
    assertThrows(() => createLiveExecutor(), "Live trading requires funder address");
  });

  await test("Live executor created with valid config", () => {
    resetEnv();
    process.env.MY_PRIVATE_KEY = "0x1234567890123456789012345678901234567890123456789012345678901234";
    process.env.FUNDER_ADDRESS = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";

    const executor = createLiveExecutor();
    assert(executor instanceof LiveTradingExecutor, "Should be LiveTradingExecutor");
    assert(executor.getMode() === "live", "Mode should be live");
  });

  // === Helper Functions ===

  await test("getTradingMode returns correct mode", () => {
    resetEnv();
    assert(getTradingMode() === "paper", "Default should be paper");

    process.env.TRADING_MODE = "live";
    assert(getTradingMode() === "live", "Should be live when env set");

    process.env.TRADING_MODE = "paper";
    assert(getTradingMode() === "paper", "Should be paper when env set");
  });

  await test("isPaperTrading returns correct boolean", () => {
    resetEnv();
    assert(isPaperTrading() === true, "Default should be true");

    process.env.TRADING_MODE = "live";
    assert(isPaperTrading() === false, "Should be false when live");
  });

  await test("isLiveTrading returns correct boolean", () => {
    resetEnv();
    assert(isLiveTrading() === false, "Default should be false");

    process.env.TRADING_MODE = "live";
    assert(isLiveTrading() === true, "Should be true when live");
  });

  // Restore env
  process.env = originalEnv;

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
