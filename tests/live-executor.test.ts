
import { LiveTradingExecutor, LiveExecutorConfig } from "../src/execution/live-executor";
import { OrderSpec, OrderResult } from "../src/types";

// Mock ClobClient
class MockClobClient {
  public orders = new Map<string, any>();
  public balances = { collateral: 1000 };
  public shouldFail = false;
  public failReason = "Mock error";
  public immediateMatch = true;

  async getOk() { return "OK"; }

  async getBalanceAllowance(args: any) {
    return {
      balance: (this.balances.collateral * 1e6).toString(),
      allowance: (10000 * 1e6).toString()
    };
  }

  async createAndPostMarketOrder(args: any) {
    if (this.shouldFail) {
      return { success: false, errorMsg: this.failReason };
    }
    const orderID = `mock-market-${Date.now()}`;
    const response = {
      success: true,
      orderID,
      status: this.immediateMatch ? "matched" : "live",
      transactionHash: "0x123"
    };

    this.orders.set(orderID, {
      ...args,
      orderID,
      status: response.status,
      original_size: args.amount, // simplification
      size_matched: this.immediateMatch ? args.amount : "0",
      price: args.price || "0.5"
    });

    return response;
  }

  async createAndPostOrder(args: any) {
    if (this.shouldFail) {
      return { success: false, errorMsg: this.failReason };
    }
    const orderID = `mock-limit-${Date.now()}`;
    const response = {
      success: true,
      orderID,
      status: this.immediateMatch ? "matched" : "live"
    };

    this.orders.set(orderID, {
      ...args,
      orderID,
      status: response.status,
      original_size: args.size,
      size_matched: this.immediateMatch ? args.size : "0",
      price: args.price
    });

    return response;
  }

  async getOrder(orderID: string) {
    return this.orders.get(orderID) || { status: "unknown" };
  }

  async cancelOrder(args: any) {
    const order = this.orders.get(args.orderID);
    if (order) {
      order.status = "cancelled";
    }
    return { success: true };
  }
}

// Testable subclass to inject mock
class TestableLiveExecutor extends LiveTradingExecutor {
  public mockClient: MockClobClient;

  constructor(config: LiveExecutorConfig) {
    super(config);
    this.mockClient = new MockClobClient();
    (this as any).client = this.mockClient;
    (this as any).isInitialized = true;
    // Bypass wallet creation
    (this as any).wallet = { getAddress: async () => "0xUser" };
  }

  // Expose for testing
  public getCircuitBreaker() {
    return (this as any).circuitBreaker;
  }
}

// Test runner
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}`);
    console.error(e);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function runTests() {
  console.log("Testing LiveTradingExecutor...");

  const config: LiveExecutorConfig = {
    privateKey: "0x123", // Dummy
    funderAddress: "0xFunder",
    signatureType: 0
  };

  await test("Executes market order successfully", async () => {
    const executor = new TestableLiveExecutor(config);
    const order: OrderSpec = {
      tokenId: "token1",
      side: "BUY",
      size: 100,
      price: 0.5,
      orderType: "market"
    };

    const result = await executor.execute(order);
    assert(result.status === "filled", `Expected filled, got ${result.status}`);
    assert(result.filledSize === 100, "Expected full fill");
  });

  await test("Executes limit order successfully", async () => {
    const executor = new TestableLiveExecutor(config);
    const order: OrderSpec = {
      tokenId: "token1",
      side: "BUY",
      size: 100,
      price: 0.5,
      orderType: "limit"
    };

    const result = await executor.execute(order);
    assert(result.status === "filled", `Expected filled, got ${result.status}`);
  });

  await test("Handles API failure", async () => {
    const executor = new TestableLiveExecutor(config);
    executor.mockClient.shouldFail = true;

    const order: OrderSpec = {
      tokenId: "token1",
      side: "BUY",
      size: 100,
      price: 0.5,
      orderType: "limit"
    };

    const result = await executor.execute(order);
    assert(result.status === "failed", "Expected failure");
    assert(result.error?.includes("Mock error") || false, "Expected error message");
  });

  await test("Circuit breaker opens after multiple failures", async () => {
    const executor = new TestableLiveExecutor(config);
    executor.mockClient.shouldFail = true;

     const order: OrderSpec = {
      tokenId: "token1",
      side: "BUY",
      size: 100,
      price: 0.5,
      orderType: "limit"
    };

    // Default CB is 5 failures
    for (let i = 0; i < 5; i++) {
        await executor.execute(order);
    }

    const cb = executor.getCircuitBreaker();
    assert(!cb.allowRequest(), "Circuit breaker should be open");

    const result = await executor.execute(order);
    assert(result.error?.includes("Circuit breaker open") || false, "Should return CB error");
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests();
