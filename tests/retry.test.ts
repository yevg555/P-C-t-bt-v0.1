/**
 * RETRY UTILITIES TESTS
 * =====================
 * Run with: npx ts-node tests/retry.test.ts
 */

import { withRetry, CircuitBreaker } from '../src/utils/retry';

// Simple async test runner
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

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function main() {
  console.log('\n📝 Testing Retry Utilities\n');

  // ============================================
  // withRetry TESTS
  // ============================================

  await test('withRetry succeeds immediately', async () => {
    const fn = async () => 'success';
    const result = await withRetry(fn);
    assertEqual(result, 'success', 'Should return result');
  });

  await test('withRetry retries on failure', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 2) throw new Error('fail');
      return 'success';
    };

    // Use small delay to speed up test, and force retry
    const result = await withRetry(fn, {
      initialDelayMs: 1,
      retryIf: () => true
    });
    assertEqual(result, 'success', 'Should eventually succeed');
    assertEqual(attempts, 2, 'Should retry once');
  });

  await test('withRetry fails after max retries', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('persistent fail');
    };

    try {
      await withRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 1,
        retryIf: () => true
      });
      throw new Error('Should have thrown');
    } catch (e: any) {
      assertEqual(e.message, 'persistent fail', 'Should throw last error');
      // maxRetries=2 means: initial attempt + 2 retries = 3 total attempts
      assertEqual(attempts, 3, 'Should attempt 3 times (1 initial + 2 retries)');
    }
  });

  await test('withRetry respects retryIf', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      throw new Error('fatal error');
    };

    const retryIf = (err: any) => err.message !== 'fatal error';

    try {
      await withRetry(fn, { maxRetries: 3, retryIf, initialDelayMs: 1 });
      throw new Error('Should have thrown');
    } catch (e: any) {
      assertEqual(e.message, 'fatal error', 'Should throw specific error');
      assertEqual(attempts, 1, 'Should not retry fatal error');
    }
  });

  // ============================================
  // CircuitBreaker TESTS
  // ============================================

  await test('CircuitBreaker starts closed', async () => {
    const cb = new CircuitBreaker();
    assertEqual(cb.getState(), 'closed', 'Initial state should be closed');
    assertEqual(cb.allowRequest(), true, 'Should allow request');
  });

  await test('CircuitBreaker opens after threshold failures', async () => {
    const cb = new CircuitBreaker(3, 1000); // 3 failures, 1s cooldown

    cb.recordFailure();
    cb.recordFailure();
    assertEqual(cb.getState(), 'closed', 'Should still be closed after 2 failures');

    cb.recordFailure();
    assertEqual(cb.getState(), 'open', 'Should open after 3rd failure');
    assertEqual(cb.allowRequest(), false, 'Should block request');
  });

  await test('CircuitBreaker resets on success', async () => {
    const cb = new CircuitBreaker(3, 1000);
    cb.recordFailure();
    cb.recordFailure();

    cb.recordSuccess();
    assertEqual(cb.getFailures(), 0, 'Failures should reset');
    assertEqual(cb.getState(), 'closed', 'State should be closed');
  });

  await test('CircuitBreaker half-open after cooldown', async () => {
    const cooldownMs = 50;
    const cb = new CircuitBreaker(3, cooldownMs);

    // Trip it
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assertEqual(cb.getState(), 'open', 'Should be open');

    // Wait for cooldown
    await new Promise(r => setTimeout(r, cooldownMs + 10));

    // Check allowRequest -> triggers half-open
    assertEqual(cb.allowRequest(), true, 'Should allow probe request');
    assertEqual(cb.getState(), 'half-open', 'Should be half-open');

    // Subsequent calls while half-open should still be allowed?
    // Implementation says: "half-open: allow the probe" -> return true.
    // So yes.
    assertEqual(cb.allowRequest(), true, 'Should allow subsequent request in half-open');
  });

  await test('CircuitBreaker closes after success in half-open', async () => {
    const cooldownMs = 50;
    const cb = new CircuitBreaker(3, cooldownMs);

    // Trip it
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    // Wait
    await new Promise(r => setTimeout(r, cooldownMs + 10));

    // Probe
    cb.allowRequest(); // enters half-open

    // Success
    cb.recordSuccess();
    assertEqual(cb.getState(), 'closed', 'Should close after success');
    assertEqual(cb.getFailures(), 0, 'Failures should be 0');
  });

  await test('CircuitBreaker re-opens on failure in half-open', async () => {
    const cooldownMs = 50;
    const cb = new CircuitBreaker(3, cooldownMs);

    // Trip it
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    // Wait
    await new Promise(r => setTimeout(r, cooldownMs + 10));

    // Probe
    cb.allowRequest(); // enters half-open

    // Fail again
    cb.recordFailure();

    assertEqual(cb.getState(), 'open', 'Should re-open on failure');
  });

  // === Summary ===
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

main().catch(console.error);
