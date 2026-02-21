
import { PositionPoller } from '../src/polling/position-poller';
import { PolymarketAPI } from '../src/api/polymarket-api';
import { Position, PositionChange } from '../src/types';

// === MOCKING ===

// Store original method to restore later
const originalGetPositions = PolymarketAPI.prototype.getPositions;

let mockPositions: Position[] = [];

// Mock getPositions
PolymarketAPI.prototype.getPositions = async function(address: string): Promise<Position[]> {
  return [...mockPositions]; // Return copy
};

// === TEST INFRASTRUCTURE ===

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
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// === TESTS ===

console.log('\n📝 Testing PositionPoller\n');

(async () => {
  try {

    await test('Poller emits "poll" event with positions', async () => {
      mockPositions = [
        { tokenId: 't1', marketId: 'm1', quantity: 100, avgPrice: 0.5, curPrice: 0.55 }
      ];

      const poller = new PositionPoller({
        traderAddress: '0x123',
        intervalMs: 100,
        maxConsecutiveErrors: 3
      });

      let pollData: Position[] | null = null;
      poller.on('poll', (positions: Position[]) => {
        pollData = positions;
      });

      // Manually trigger poll (accessing private method via any)
      await (poller as any).poll();

      assert(pollData !== null, 'Poll event should be emitted');
      assertEqual(pollData!.length, 1, 'Should return 1 position');
      assertEqual(pollData![0].tokenId, 't1', 'Token ID should match');
    });

    await test('Poller detects changes', async () => {
      // 1. Initial state
      mockPositions = [
        { tokenId: 't1', marketId: 'm1', quantity: 100, avgPrice: 0.5, curPrice: 0.55 }
      ];

      const poller = new PositionPoller({
        traderAddress: '0x123',
        intervalMs: 100,
        maxConsecutiveErrors: 3
      });

      let changes: PositionChange[] = [];

      poller.on('change', (change: PositionChange) => {
        changes.push(change);
      });

      // First poll - snapshot (no changes detected yet)
      await (poller as any).poll();
      assertEqual(changes.length, 0, 'No changes on first poll');

      // 2. Update state - quantity change
      mockPositions = [
        { tokenId: 't1', marketId: 'm1', quantity: 150, avgPrice: 0.55, curPrice: 0.60 }
      ];

      // Second poll - should detect change
      await (poller as any).poll();

      assertEqual(changes.length, 1, 'Should detect 1 change');
      assertEqual(changes[0].tokenId, 't1', 'Token ID should match');
      assertEqual(changes[0].delta, 50, 'Delta should be 50');
      assertEqual(changes[0].side, 'BUY', 'Side should be BUY');
    });

    // === SUMMARY ===

    console.log('\n' + '─'.repeat(40));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('─'.repeat(40));

    // Restore original method
    PolymarketAPI.prototype.getPositions = originalGetPositions;

    if (failed > 0) {
      process.exit(1);
    } else {
      console.log('SUCCESS');
    }

  } catch (err) {
    console.error('Test suite failed:', err);
    process.exit(1);
  }
})();
