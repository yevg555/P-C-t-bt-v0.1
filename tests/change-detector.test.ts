/**
 * CHANGE DETECTOR TESTS
 * =====================
 * Tests for the ChangeDetector class
 * 
 * Run with: npm run test:detector
 */

import { ChangeDetector } from '../src/polling/change-detector';
import { Position } from '../src/types';

// Simple test runner
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
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

// Helper to create positions
function pos(tokenId: string, quantity: number, marketId = 'm1'): Position {
  return { tokenId, marketId, quantity, avgPrice: 0.5 };
}

// === Tests ===

console.log('\n📝 Testing ChangeDetector\n');

const detector = new ChangeDetector(0.01);

test('No changes when positions identical', () => {
  const positions = [pos('A', 100)];
  const changes = detector.detectChanges(positions, positions);
  assertEqual(changes.length, 0, 'Should detect no changes');
});

test('Detects NEW position (first buy)', () => {
  const prev: Position[] = [];
  const curr = [pos('A', 100)];
  
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 1, 'Should detect 1 change');
  assertEqual(changes[0].side, 'BUY', 'Should be BUY');
  assertEqual(changes[0].delta, 100, 'Delta should be 100');
  assertEqual(changes[0].previousQuantity, 0, 'Previous should be 0');
  assertEqual(changes[0].currentQuantity, 100, 'Current should be 100');
});

test('Detects INCREASED position (buy more)', () => {
  const prev = [pos('A', 100)];
  const curr = [pos('A', 150)];
  
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 1, 'Should detect 1 change');
  assertEqual(changes[0].side, 'BUY', 'Should be BUY');
  assertEqual(changes[0].delta, 50, 'Delta should be 50');
  assertEqual(changes[0].previousQuantity, 100, 'Previous should be 100');
  assertEqual(changes[0].currentQuantity, 150, 'Current should be 150');
});

test('Detects DECREASED position (partial sell)', () => {
  const prev = [pos('A', 100)];
  const curr = [pos('A', 30)];
  
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 1, 'Should detect 1 change');
  assertEqual(changes[0].side, 'SELL', 'Should be SELL');
  assertEqual(changes[0].delta, 70, 'Delta should be 70');
  assertEqual(changes[0].previousQuantity, 100, 'Previous should be 100');
  assertEqual(changes[0].currentQuantity, 30, 'Current should be 30');
});

test('Detects CLOSED position (full sell)', () => {
  const prev = [pos('A', 100)];
  const curr: Position[] = [];
  
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 1, 'Should detect 1 change');
  assertEqual(changes[0].side, 'SELL', 'Should be SELL');
  assertEqual(changes[0].delta, 100, 'Delta should be 100');
  assertEqual(changes[0].previousQuantity, 100, 'Previous should be 100');
  assertEqual(changes[0].currentQuantity, 0, 'Current should be 0');
});

test('Detects CLOSED position (quantity becomes 0)', () => {
  const prev = [pos('A', 100)];
  const curr = [pos('A', 0)];
  
  // Note: Our API client filters out 0-quantity positions,
  // but the detector should handle this case anyway
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 1, 'Should detect 1 change');
  assertEqual(changes[0].side, 'SELL', 'Should be SELL');
});

test('Handles MULTIPLE changes at once', () => {
  const prev = [
    pos('A', 100),  // Will increase
    pos('B', 200),  // Will be closed
  ];
  const curr = [
    pos('A', 150),  // Increased by 50
    pos('C', 50),   // New position
    // B is gone
  ];
  
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 3, 'Should detect 3 changes');
  
  // Find each change
  const changeA = changes.find(c => c.tokenId === 'A');
  const changeB = changes.find(c => c.tokenId === 'B');
  const changeC = changes.find(c => c.tokenId === 'C');
  
  assert(changeA !== undefined, 'Should have change for A');
  assertEqual(changeA!.side, 'BUY', 'A should be BUY');
  assertEqual(changeA!.delta, 50, 'A delta should be 50');
  
  assert(changeB !== undefined, 'Should have change for B');
  assertEqual(changeB!.side, 'SELL', 'B should be SELL');
  assertEqual(changeB!.delta, 200, 'B delta should be 200');
  
  assert(changeC !== undefined, 'Should have change for C');
  assertEqual(changeC!.side, 'BUY', 'C should be BUY');
  assertEqual(changeC!.delta, 50, 'C delta should be 50');
});

test('Ignores tiny changes (below minDelta)', () => {
  const prev = [pos('A', 100)];
  const curr = [pos('A', 100.005)]; // Change of 0.005, below 0.01 threshold
  
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 0, 'Should ignore tiny change');
});

test('Detects change at exactly minDelta', () => {
  const prev = [pos('A', 100)];
  const curr = [pos('A', 100.01)]; // Change of exactly 0.01
  
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 1, 'Should detect change at threshold');
});

test('Ignores tiny new positions', () => {
  const prev: Position[] = [];
  const curr = [pos('A', 0.005)]; // Too small
  
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 0, 'Should ignore tiny new position');
});

test('Ignores tiny closed positions', () => {
  const prev = [pos('A', 0.005)]; // Very small
  const curr: Position[] = [];
  
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 0, 'Should ignore tiny closed position');
});

test('Handles empty arrays', () => {
  const changes = detector.detectChanges([], []);
  assertEqual(changes.length, 0, 'Should return empty array');
});

test('Handles large position arrays', () => {
  const prev: Position[] = [];
  const curr: Position[] = [];
  
  // Create 100 positions
  for (let i = 0; i < 100; i++) {
    prev.push(pos(`token-${i}`, i * 10));
    // Half changed, half same
    curr.push(pos(`token-${i}`, i % 2 === 0 ? i * 10 : i * 10 + 50));
  }
  
  const changes = detector.detectChanges(prev, curr);
  
  // Every odd token should have increased by 50
  assertEqual(changes.length, 50, 'Should detect 50 changes');
  
  for (const change of changes) {
    assertEqual(change.side, 'BUY', 'All should be BUY');
    assertEqual(change.delta, 50, 'All deltas should be 50');
  }
});

test('Preserves market ID in changes', () => {
  const prev: Position[] = [];
  const curr = [{ tokenId: 'A', marketId: 'market-123', quantity: 100, avgPrice: 0.5 }];
  
  const changes = detector.detectChanges(prev, curr);
  
  assertEqual(changes[0].marketId, 'market-123', 'Should preserve market ID');
});

test('Change has detectedAt timestamp', () => {
  const prev: Position[] = [];
  const curr = [pos('A', 100)];
  
  const before = new Date();
  const changes = detector.detectChanges(prev, curr);
  const after = new Date();
  
  assert(changes[0].detectedAt >= before, 'Timestamp should be >= before');
  assert(changes[0].detectedAt <= after, 'Timestamp should be <= after');
});

test('Custom minDelta works', () => {
  const sensitiveDetector = new ChangeDetector(0.001); // More sensitive
  
  const prev = [pos('A', 100)];
  const curr = [pos('A', 100.005)];
  
  const changes = sensitiveDetector.detectChanges(prev, curr);
  
  assertEqual(changes.length, 1, 'Sensitive detector should catch small change');
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
