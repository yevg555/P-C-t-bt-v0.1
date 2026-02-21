/**
 * CACHE TESTS
 * ===========
 * Tests for the Cache class
 *
 * Run with: npm run test:cache
 */

import { Cache } from '../src/utils/cache';

// Simple test runner
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
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
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Tests ===

console.log('\n📝 Testing Cache\n');

(async () => {
  await test('Cache stores and retrieves values', () => {
    const cache = new Cache<number>(1000);
    cache.set('key1', 42);

    const val = cache.get('key1');
    assertEqual(val, 42, 'Should retrieve value');
  });

  await test('Cache returns undefined for missing keys', () => {
    const cache = new Cache<number>(1000);
    const val = cache.get('missing');
    assertEqual(val, undefined, 'Should return undefined');
  });

  await test('Cache respects TTL', async () => {
    const cache = new Cache<string>(100); // 100ms TTL
    cache.set('key1', 'value1');

    assertEqual(cache.get('key1'), 'value1', 'Should exist initially');

    await sleep(150);

    assertEqual(cache.get('key1'), undefined, 'Should be expired');
  });

  await test('getStale returns expired values', async () => {
    const cache = new Cache<string>(100); // 100ms TTL
    cache.set('key1', 'value1');

    await sleep(150);

    assertEqual(cache.get('key1'), undefined, 'Should be expired for get()');
    assertEqual(cache.getStale('key1'), 'value1', 'Should be available via getStale()');
  });

  await test('Clear removes all items', () => {
    const cache = new Cache<number>(1000);
    cache.set('key1', 1);
    cache.set('key2', 2);

    cache.clear();

    assertEqual(cache.get('key1'), undefined, 'Should be cleared');
    assertEqual(cache.get('key2'), undefined, 'Should be cleared');
    assertEqual(cache.getStale('key1'), undefined, 'Should be cleared from stale too');
  });

  await test('setTtl updates TTL', async () => {
    const cache = new Cache<string>(100);
    cache.set('key1', 'value1');

    cache.setTtl(500); // Increase TTL

    await sleep(150);

    assertEqual(cache.get('key1'), 'value1', 'Should still be valid with new TTL');
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
})();
