/**
 * POSITION CACHE TESTS
 * ====================
 * Tests for the PositionCache class
 * 
 * Run with: npm run test:cache
 */

import { PositionCache } from '../src/polling/position-cache';
import { Position } from '../src/types';

// Simple test runner (no Jest required)
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
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

// === Tests ===

console.log('\n📝 Testing PositionCache\n');

test('Empty cache should be empty', () => {
  const cache = new PositionCache();
  assert(cache.isEmpty(), 'Should be empty');
  assertEqual(cache.size(), 0, 'Size should be 0');
});

test('Update adds positions', () => {
  const cache = new PositionCache();
  const positions: Position[] = [
    { tokenId: 'token-1', marketId: 'm1', quantity: 100, avgPrice: 0.5 },
    { tokenId: 'token-2', marketId: 'm2', quantity: 200, avgPrice: 0.3 },
  ];
  
  cache.update(positions);
  
  assertEqual(cache.size(), 2, 'Should have 2 positions');
  assert(!cache.isEmpty(), 'Should not be empty');
});

test('Get returns correct position', () => {
  const cache = new PositionCache();
  const positions: Position[] = [
    { tokenId: 'token-1', marketId: 'm1', quantity: 100, avgPrice: 0.5 },
  ];
  
  cache.update(positions);
  
  const pos = cache.get('token-1');
  assert(pos !== undefined, 'Should find position');
  assertEqual(pos!.quantity, 100, 'Quantity should match');
  assertEqual(pos!.avgPrice, 0.5, 'Price should match');
});

test('Get returns undefined for missing token', () => {
  const cache = new PositionCache();
  cache.update([{ tokenId: 'token-1', marketId: 'm1', quantity: 100, avgPrice: 0.5 }]);
  
  const pos = cache.get('nonexistent');
  assertEqual(pos, undefined, 'Should return undefined');
});

test('Has returns correct boolean', () => {
  const cache = new PositionCache();
  cache.update([{ tokenId: 'token-1', marketId: 'm1', quantity: 100, avgPrice: 0.5 }]);
  
  assert(cache.has('token-1'), 'Should have token-1');
  assert(!cache.has('token-2'), 'Should not have token-2');
});

test('Update replaces all positions', () => {
  const cache = new PositionCache();
  
  // First update
  cache.update([
    { tokenId: 'token-1', marketId: 'm1', quantity: 100, avgPrice: 0.5 },
    { tokenId: 'token-2', marketId: 'm2', quantity: 200, avgPrice: 0.3 },
  ]);
  
  assertEqual(cache.size(), 2, 'Should have 2 positions');
  assert(cache.has('token-2'), 'Should have token-2');
  
  // Second update (token-2 gone, token-3 new)
  cache.update([
    { tokenId: 'token-1', marketId: 'm1', quantity: 150, avgPrice: 0.55 },
    { tokenId: 'token-3', marketId: 'm3', quantity: 50, avgPrice: 0.7 },
  ]);
  
  assertEqual(cache.size(), 2, 'Should still have 2 positions');
  assert(!cache.has('token-2'), 'token-2 should be gone');
  assert(cache.has('token-3'), 'token-3 should exist');
  assertEqual(cache.get('token-1')!.quantity, 150, 'token-1 quantity should be updated');
});

test('GetAll returns all positions', () => {
  const cache = new PositionCache();
  cache.update([
    { tokenId: 'token-1', marketId: 'm1', quantity: 100, avgPrice: 0.5 },
    { tokenId: 'token-2', marketId: 'm2', quantity: 200, avgPrice: 0.3 },
  ]);
  
  const all = cache.getAll();
  assertEqual(all.length, 2, 'Should return 2 positions');
});

test('GetAll returns clones (no mutation)', () => {
  const cache = new PositionCache();
  cache.update([{ tokenId: 'token-1', marketId: 'm1', quantity: 100, avgPrice: 0.5 }]);
  
  const all = cache.getAll();
  all[0].quantity = 999; // Mutate the returned object
  
  // Original should be unchanged
  assertEqual(cache.get('token-1')!.quantity, 100, 'Original should be unchanged');
});

test('Clear removes all positions', () => {
  const cache = new PositionCache();
  cache.update([{ tokenId: 'token-1', marketId: 'm1', quantity: 100, avgPrice: 0.5 }]);
  
  cache.clear();
  
  assert(cache.isEmpty(), 'Should be empty after clear');
  assertEqual(cache.getLastUpdated(), null, 'Last updated should be null');
});

test('GetLastUpdated returns date after update', () => {
  const cache = new PositionCache();
  
  assertEqual(cache.getLastUpdated(), null, 'Should be null initially');
  
  cache.update([{ tokenId: 'token-1', marketId: 'm1', quantity: 100, avgPrice: 0.5 }]);
  
  const lastUpdated = cache.getLastUpdated();
  assert(lastUpdated !== null, 'Should have timestamp');
  assert(lastUpdated instanceof Date, 'Should be a Date');
});

test('GetTokenIds returns all token IDs', () => {
  const cache = new PositionCache();
  cache.update([
    { tokenId: 'aaa', marketId: 'm1', quantity: 100, avgPrice: 0.5 },
    { tokenId: 'bbb', marketId: 'm2', quantity: 200, avgPrice: 0.3 },
  ]);
  
  const ids = cache.getTokenIds();
  assertEqual(ids.length, 2, 'Should have 2 IDs');
  assert(ids.includes('aaa'), 'Should include aaa');
  assert(ids.includes('bbb'), 'Should include bbb');
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
