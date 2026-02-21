/**
 * DASHBOARD SECURITY TESTS
 * ========================
 * Run with: npx ts-node tests/dashboard-security.test.ts
 */

import { DashboardServer, DashboardBotInterface } from "../src/dashboard/server";
import { OrderExecutor } from "../src/types";
import { TradeStore } from "../src/storage";
import { fetch } from "undici";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
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

// Mock dependencies
const mockBot: DashboardBotInterface = {
  getStats: () => ({
    pollerStats: {},
    tradeCount: 0,
    totalPnL: 0,
    dailyPnL: 0,
    mode: "test",
    pollingMethod: "test",
    latencyStats: {
      avgDetectionMs: 0,
      avgExecutionMs: 0,
      avgTotalMs: 0,
      sampleCount: 0,
      clockDriftOffset: 0,
    },
  }),
  getExecutor: () => ({} as OrderExecutor),
  getTradeStore: () => ({} as TradeStore),
};

console.log('\n🔒 Testing Dashboard Security Headers\n');

async function runTests() {
  const port = 3457;
  const server = new DashboardServer(mockBot, port);

  console.log('Starting server...');
  // start() resolves when the server is listening
  await server.start();

  await test('Should have Content-Security-Policy header', async () => {
    const res = await fetch(`http://localhost:${port}/`);
    const csp = res.headers.get("content-security-policy");

    assert(!!csp, "Missing Content-Security-Policy header");
    // Verify it allows inline scripts/styles as we intend to configure
    // But initially it will just fail on missing header
    if (csp) {
      console.log(`     CSP: ${csp}`);
    }
  });

  await test('Should have X-Frame-Options header', async () => {
    const res = await fetch(`http://localhost:${port}/`);
    const xfo = res.headers.get("x-frame-options");

    assert(!!xfo, "Missing X-Frame-Options header");
    if (xfo) {
      console.log(`     X-Frame-Options: ${xfo}`);
    }
  });

  await test('Should have X-Content-Type-Options header', async () => {
    const res = await fetch(`http://localhost:${port}/`);
    const xcto = res.headers.get("x-content-type-options");

    assert(!!xcto, "Missing X-Content-Type-Options header");
  });

  console.log('Stopping server...');
  server.stop();

  // Wait for stop
  await new Promise(r => setTimeout(r, 500));

  console.log('\n' + '─'.repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('─'.repeat(40));

  if (failed > 0) {
    console.log('\n❌ Some tests failed!\n');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!\n');
  }
}

runTests().catch(err => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
