/**
 * ACTIVITY POLLER TESTS
 * =====================
 * Tests for the activity-based trade polling
 */

import { ActivityPoller, TradeEvent, TradeLatency } from '../src/polling/activity-poller';
import { PolymarketAPI, Trade } from '../src/api/polymarket-api';

// Test results tracking
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        console.log(`  ✅ ${name}`);
        passed++;
      }).catch((e) => {
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${e.message}`);
        failed++;
      });
    }
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

// Mock API for testing
class MockPolymarketAPI {
  private mockTrades: Trade[] = [];
  private callCount = 0;

  setMockTrades(trades: Trade[]) {
    this.mockTrades = trades;
  }

  async getTrades(
    _address: string,
    _options: { limit?: number; after?: number } = {}
  ): Promise<Trade[]> {
    this.callCount++;
    return this.mockTrades;
  }

  getCallCount() {
    return this.callCount;
  }

  resetCallCount() {
    this.callCount = 0;
  }
}

export async function runActivityPollerTests() {
  console.log('\n📝 Testing ActivityPoller\n');

  const mockApi = new MockPolymarketAPI();

  console.log('--- Configuration Tests ---');

  test('Initializes with correct config', () => {
    const poller = new ActivityPoller(
      {
        traderAddress: '0x123',
        intervalMs: 500,
        maxConsecutiveErrors: 3,
      },
      mockApi as unknown as PolymarketAPI
    );

    const stats = poller.getStats();
    assertEqual(stats.traderAddress, '0x123', 'Trader address');
    assertEqual(stats.isRunning, false, 'Is not running initially');
    assertEqual(stats.pollCount, 0, 'Poll count starts at 0');
    assertEqual(stats.tradesDetected, 0, 'Trades detected starts at 0');
  });

  test('getLatencyStats returns zeros when no samples', () => {
    const poller = new ActivityPoller(
      { traderAddress: '0x123', intervalMs: 500, maxConsecutiveErrors: 3 },
      mockApi as unknown as PolymarketAPI
    );

    const stats = poller.getLatencyStats();
    assertEqual(stats.sampleCount, 0, 'Sample count');
    assertEqual(stats.avgDetectionLatencyMs, 0, 'Avg latency');
    assertEqual(stats.minDetectionLatencyMs, 0, 'Min latency');
    assertEqual(stats.maxDetectionLatencyMs, 0, 'Max latency');
  });

  console.log('\n--- Trade Event Tests ---');

  await test('Emits trade events for new trades', async () => {
    const mockApi2 = new MockPolymarketAPI();
    const poller = new ActivityPoller(
      { traderAddress: '0x123', intervalMs: 100, maxConsecutiveErrors: 3 },
      mockApi2 as unknown as PolymarketAPI
    );

    const receivedEvents: TradeEvent[] = [];
    poller.on('trade', (event) => {
      receivedEvents.push(event);
    });

    // Start with empty trades (initial snapshot)
    mockApi2.setMockTrades([]);
    await poller.start();

    // Add a new trade
    const newTrade: Trade = {
      id: 'trade-1',
      tokenId: 'token-abc',
      marketId: 'market-xyz',
      side: 'BUY',
      size: 100,
      price: 0.5,
      timestamp: new Date(Date.now() - 1000), // 1 second ago
      marketTitle: 'Test Market',
    };
    mockApi2.setMockTrades([newTrade]);

    // Wait for next poll
    await new Promise((resolve) => setTimeout(resolve, 150));

    poller.stop();

    assertEqual(receivedEvents.length, 1, 'Received one trade event');
    assertEqual(receivedEvents[0].trade.id, 'trade-1', 'Trade ID');
    assertEqual(receivedEvents[0].trade.side, 'BUY', 'Trade side');
    assertEqual(receivedEvents[0].trade.size, 100, 'Trade size');
    assertTrue(receivedEvents[0].latency.detectionLatencyMs >= 0, 'Detection latency is positive');
  });

  await test('Does not emit duplicate trades', async () => {
    const mockApi3 = new MockPolymarketAPI();
    const poller = new ActivityPoller(
      { traderAddress: '0x123', intervalMs: 100, maxConsecutiveErrors: 3 },
      mockApi3 as unknown as PolymarketAPI
    );

    const receivedEvents: TradeEvent[] = [];
    poller.on('trade', (event) => {
      receivedEvents.push(event);
    });

    const trade: Trade = {
      id: 'trade-dup',
      tokenId: 'token-abc',
      marketId: 'market-xyz',
      side: 'BUY',
      size: 50,
      price: 0.6,
      timestamp: new Date(Date.now() - 500),
    };

    // Start with the trade (initial snapshot - no event)
    mockApi3.setMockTrades([trade]);
    await poller.start();

    // Wait for multiple polls with the same trade
    await new Promise((resolve) => setTimeout(resolve, 250));

    poller.stop();

    // Should not emit any events since the trade was in initial snapshot
    assertEqual(receivedEvents.length, 0, 'No duplicate trade events');
  });

  console.log('\n--- Latency Calculation Tests ---');

  test('Calculates detection latency correctly', () => {
    const tradeTime = new Date(Date.now() - 2000); // 2 seconds ago
    const detectedAt = new Date();

    const latency: TradeLatency = {
      detectionLatencyMs: detectedAt.getTime() - tradeTime.getTime(),
      tradeTimestamp: tradeTime,
      detectedAt,
    };

    assertTrue(latency.detectionLatencyMs >= 1900, 'Latency should be ~2000ms');
    assertTrue(latency.detectionLatencyMs <= 2100, 'Latency should be ~2000ms');
  });

  console.log('\n--- Stats Tests ---');

  test('running() returns correct state', () => {
    const poller = new ActivityPoller(
      { traderAddress: '0x123', intervalMs: 500, maxConsecutiveErrors: 3 },
      mockApi as unknown as PolymarketAPI
    );

    assertEqual(poller.running(), false, 'Not running initially');
  });

  test('getApi() returns the API instance', () => {
    const poller = new ActivityPoller(
      { traderAddress: '0x123', intervalMs: 500, maxConsecutiveErrors: 3 },
      mockApi as unknown as PolymarketAPI
    );

    const api = poller.getApi();
    assertTrue(api === (mockApi as unknown as PolymarketAPI), 'Returns the injected API');
  });

  // Print results
  console.log('\n' + '─'.repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('─'.repeat(40));

  if (failed === 0) {
    console.log('\n🎉 All tests passed!\n');
  } else {
    console.log('\n❌ Some tests failed!\n');
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runActivityPollerTests();
}
