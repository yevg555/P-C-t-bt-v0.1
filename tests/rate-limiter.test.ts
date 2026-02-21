/**
 * RATE LIMITER TESTS
 * ==================
 * Tests for the RateLimiter utility class.
 *
 * Run with: npx ts-node tests/rate-limiter.test.ts
 */

import { RateLimiter } from '../src/utils/rate-limiter';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => {
        console.log(`  ✅ ${name}`);
        passed++;
      }).catch((error) => {
        console.log(`  ❌ ${name}`);
        console.log(`     Error: ${error}`);
        failed++;
      });
    } else {
      console.log(`  ✅ ${name}`);
      passed++;
    }
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// ================================================
console.log('\n⏱️  Testing RateLimiter\n');
// ================================================

(async () => {
  await testWrapper('First request should not wait', async () => {
    const limiter = new RateLimiter(50);
    const start = Date.now();
    await limiter.waitForToken();
    const elapsed = Date.now() - start;

    // Should be very fast, effectively 0 wait
    assert(elapsed < 20, `Should not wait on first call (took ${elapsed}ms)`);
  });

  await testWrapper('Second request within interval should wait', async () => {
    const interval = 50;
    const limiter = new RateLimiter(interval);

    // First call (sets timestamp)
    await limiter.waitForToken();

    const start = Date.now();
    // Second call (should wait ~50ms)
    await limiter.waitForToken();
    const elapsed = Date.now() - start;

    // Allow small margin for execution time
    assert(elapsed >= interval - 5, `Should wait at least ${interval}ms (took ${elapsed}ms)`);
    assert(elapsed < interval + 30, `Should not wait too long (took ${elapsed}ms)`);
  });

  await testWrapper('Request after interval should not wait', async () => {
    const interval = 50;
    const limiter = new RateLimiter(interval);

    // First call
    await limiter.waitForToken();

    // Manually wait longer than interval
    await new Promise(resolve => setTimeout(resolve, interval + 20));

    const start = Date.now();
    // Should not wait again
    await limiter.waitForToken();
    const elapsed = Date.now() - start;

    assert(elapsed < 20, `Should not wait if interval passed (took ${elapsed}ms)`);
  });

  // Summary
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();

// Helper to run async tests sequentially
async function testWrapper(name: string, fn: () => Promise<void>) {
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
