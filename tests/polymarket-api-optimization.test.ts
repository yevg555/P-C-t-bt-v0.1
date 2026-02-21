
import { PolymarketAPI } from '../src/api/polymarket-api';

// Helper to assert
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

// Test implementation of PolymarketAPI that mocks fetch
class TestPolymarketAPI extends PolymarketAPI {
  public fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  public mockResponses: Map<string, unknown> = new Map();

  constructor() {
    super();
  }

  protected async fetch(url: string, init?: RequestInit): Promise<Response> {
    this.fetchCalls.push({ url, init });

    // Simple matching for mock responses
    for (const [key, value] of this.mockResponses.entries()) {
      if (url.includes(key)) {
        return {
          ok: true,
          status: 200,
          json: async () => value,
          headers: new Map(),
        } as unknown as Response;
      }
    }

    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as unknown as Response;
  }

  public setMockResponse(urlPart: string, response: unknown) {
    this.mockResponses.set(urlPart, response);
  }

  public clearFetchCalls() {
    this.fetchCalls = [];
  }
}

async function runTests() {
  console.log('⚡ Running PolymarketAPI Optimization Tests');
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (e: unknown) {
      console.log(`  ❌ ${name}`);
      if (e instanceof Error) {
        console.log(`     Error: ${e.message}`);
      } else {
        console.log(`     Error: ${String(e)}`);
      }
      failed++;
    }
  };

  const api = new TestPolymarketAPI();
  const userAddress = '0xUser';
  const tokenA = 'TokenA';
  const tokenB = 'TokenB';
  const conditionIdA = 'ConditionA';

  // Sample trades
  const trades = [
    {
      transactionHash: 'tx1',
      timestamp: 1000,
      asset: tokenA,
      conditionId: conditionIdA,
      type: 'TRADE',
      side: 'BUY',
      size: 10,
      price: 0.5,
    },
    {
      transactionHash: 'tx2',
      timestamp: 2000,
      asset: tokenB,
      conditionId: 'ConditionB',
      type: 'TRADE',
      side: 'SELL',
      size: 20,
      price: 0.6,
    },
    {
      transactionHash: 'tx3',
      timestamp: 3000,
      asset: tokenA,
      conditionId: conditionIdA,
      type: 'TRADE',
      side: 'BUY',
      size: 15,
      price: 0.55,
    },
  ];

  // Setup mock for activity
  api.setMockResponse('/activity', trades);

  // Optimized Test: Should look up marketId and use it
  await test('getTradesForToken (optimized)', async () => {
    api.clearFetchCalls();
    api.mockResponses.clear();
    api.setMockResponse('/activity', trades); // Restore activity mock

    // Setup mock for markets lookup
    const marketsResponse = [{ conditionId: conditionIdA }];
    api.setMockResponse('/markets', marketsResponse);

    // The activity response should now ideally be filtered by the API, but our mock
    // just returns the list we set earlier. The important part is checking the REQUEST URL.

    const result = await api.getTradesForToken(userAddress, tokenA, { limit: 10 });

    // Assert correct filtering (client side filtering still happens)
    assertEqual(result.length, 2, 'Should return 2 trades for TokenA');
    assertEqual(result[0].tokenId, tokenA, 'Trade 1 should be TokenA');

    // Assert calls
    // 1. Should call /markets to lookup conditionId
    const marketCall = api.fetchCalls.find(c => c.url.includes('/markets'));
    assertTrue(!!marketCall, 'Should have called /markets');
    assertTrue(marketCall!.url.includes(`clob_token_ids=${tokenA}`), 'Should lookup correct token ID');

    // 2. Should call /activity WITH market parameter
    const activityCall = api.fetchCalls.find(c => c.url.includes('/activity'));
    assertTrue(!!activityCall, 'Should have called /activity');
    assertTrue(activityCall!.url.includes(`market=${conditionIdA}`), 'Should use market parameter');
  });

  // Test Caching: Should not look up marketId again for same token
  await test('getTradesForToken (cached marketId)', async () => {
    api.clearFetchCalls();
    // Keep mocks as is (ConditionA is cached anyway)

    const result = await api.getTradesForToken(userAddress, tokenA, { limit: 10 });

    assertEqual(result.length, 2, 'Should return 2 trades');

    // Should NOT call /markets
    const marketCall = api.fetchCalls.find(c => c.url.includes('/markets'));
    assertTrue(!marketCall, 'Should NOT call /markets (cached)');

    // Should call /activity WITH market parameter
    const activityCall = api.fetchCalls.find(c => c.url.includes('/activity'));
    assertTrue(!!activityCall, 'Should have called /activity');
    assertTrue(activityCall!.url.includes(`market=${conditionIdA}`), 'Should use market parameter');
  });

  // Test Fallback: If market lookup fails
  await test('getTradesForToken (fallback on lookup fail)', async () => {
    api.clearFetchCalls();
    api.mockResponses.clear();
    api.setMockResponse('/activity', trades); // Restore activity mock

    // We ensure /markets is NOT in mockResponses, so it returns 404

    const tokenC = 'TokenC';

    const result = await api.getTradesForToken(userAddress, tokenC, { limit: 10 });

    // Result should be empty (since our mock trades don't have TokenC)
    assertEqual(result.length, 0, 'Should return 0 trades');

    // Should have tried to call /markets
    const marketCall = api.fetchCalls.find(c => c.url.includes('/markets') && c.url.includes(tokenC));
    assertTrue(!!marketCall, 'Should have called /markets');

    // Should have called /activity WITHOUT market parameter (fallback)
    const activityCall = api.fetchCalls.find(c => c.url.includes('/activity') && !c.url.includes('market='));
    if (!activityCall) {
        console.log('Calls made:', api.fetchCalls.map(c => c.url));
    }
    assertTrue(!!activityCall, 'Should have called /activity without market param');
  });

  console.log('\n' + '─'.repeat(40));
  if (failed === 0) {
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('🎉 All tests passed!');
  } else {
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('❌ Some tests failed!');
    process.exit(1);
  }
}

runTests().catch(console.error);
