import dotenv from 'dotenv';
import { ActivityPoller } from '../src/polling/activity-poller';
import { PositionPoller } from '../src/polling/position-poller';
import { PositionChange, PollerConfig } from '../src/types';
import { Trade } from '../src/api/polymarket-api';

dotenv.config();

type PendingTrade = {
  trade: Trade;
  detectedAt: Date;
  detectionLatencyMs: number;
};

type PendingChange = {
  change: PositionChange;
  detectedAt: Date;
};

const traderAddress = process.env.TRADER_ADDRESS;
if (!traderAddress) {
  throw new Error('Missing TRADER_ADDRESS in .env');
}

const positionIntervalMs = Number(process.env.POSITIONS_INTERVAL_MS || 200);
const activityIntervalMs = Number(process.env.ACTIVITY_INTERVAL_MS || 1000);
const maxRuntimeMs = Number(process.env.MAX_RUNTIME_MS || 5 * 60 * 1000);
const matchTolerance = Number(process.env.MATCH_TOLERANCE || 0.01);
const maxPending = Number(process.env.MAX_PENDING || 200);

const baseConfig: PollerConfig = {
  traderAddress,
  intervalMs: positionIntervalMs,
  maxConsecutiveErrors: 5,
};

const activityConfig: PollerConfig = {
  ...baseConfig,
  intervalMs: activityIntervalMs,
};

const positionPoller = new PositionPoller(baseConfig);
const activityPoller = new ActivityPoller(activityConfig);

const pendingTrades: PendingTrade[] = [];
const pendingChanges: PendingChange[] = [];

let activityCount = 0;
let positionCount = 0;
let matchedCount = 0;
let sumDeltaMs = 0;
let minDeltaMs = Infinity;
let maxDeltaMs = -Infinity;

const formatMs = (value: number) => `${value.toFixed(0)}ms`;
const formatToken = (tokenId: string) => `${tokenId.slice(0, 6)}…${tokenId.slice(-4)}`;

const trimPending = (): void => {
  const now = Date.now();
  const cutoff = now - 10 * 60 * 1000; // 10 minutes
  while (pendingTrades.length > maxPending) {
    pendingTrades.shift();
  }
  while (pendingChanges.length > maxPending) {
    pendingChanges.shift();
  }
  for (let i = pendingTrades.length - 1; i >= 0; i -= 1) {
    if (pendingTrades[i].detectedAt.getTime() < cutoff) {
      pendingTrades.splice(i, 1);
    }
  }
  for (let i = pendingChanges.length - 1; i >= 0; i -= 1) {
    if (pendingChanges[i].detectedAt.getTime() < cutoff) {
      pendingChanges.splice(i, 1);
    }
  }
};

const findMatchingChange = (trade: Trade): PendingChange | null => {
  for (let i = 0; i < pendingChanges.length; i += 1) {
    const candidate = pendingChanges[i];
    if (candidate.change.tokenId !== trade.tokenId) {
      continue;
    }
    if (candidate.change.side !== trade.side) {
      continue;
    }
    const deltaDiff = Math.abs(candidate.change.delta - trade.size);
    if (deltaDiff <= matchTolerance) {
      pendingChanges.splice(i, 1);
      return candidate;
    }
  }
  return null;
};

const findMatchingTrade = (change: PositionChange): PendingTrade | null => {
  for (let i = 0; i < pendingTrades.length; i += 1) {
    const candidate = pendingTrades[i];
    if (candidate.trade.tokenId !== change.tokenId) {
      continue;
    }
    if (candidate.trade.side !== change.side) {
      continue;
    }
    const deltaDiff = Math.abs(candidate.trade.size - change.delta);
    if (deltaDiff <= matchTolerance) {
      pendingTrades.splice(i, 1);
      return candidate;
    }
  }
  return null;
};

const recordMatch = (trade: PendingTrade, change: PendingChange): void => {
  matchedCount += 1;

  const positionDetectedAt = change.detectedAt.getTime();
  const activityDetectedAt = trade.detectedAt.getTime();
  const deltaMs = positionDetectedAt - activityDetectedAt;
  const positionLatencyMs = positionDetectedAt - trade.trade.timestamp.getTime();
  const activityLatencyMs = trade.detectionLatencyMs;

  sumDeltaMs += deltaMs;
  minDeltaMs = Math.min(minDeltaMs, deltaMs);
  maxDeltaMs = Math.max(maxDeltaMs, deltaMs);

  console.log(
    `[MATCH #${matchedCount}] ${trade.trade.side} ${trade.trade.size.toFixed(2)} | ` +
      `${formatToken(trade.trade.tokenId)} | ` +
      `positions vs activity: ${formatMs(deltaMs)} ` +
      `(positions: ${formatMs(positionLatencyMs)}, activity: ${formatMs(activityLatencyMs)})`
  );
};

activityPoller.on('trade', ({ trade, latency }) => {
  activityCount += 1;
  const pendingTrade: PendingTrade = {
    trade,
    detectedAt: latency.detectedAt,
    detectionLatencyMs: latency.detectionLatencyMs,
  };

  const match = findMatchingChange(trade);
  if (match) {
    recordMatch(pendingTrade, match);
  } else {
    pendingTrades.push(pendingTrade);
  }

  trimPending();
});

positionPoller.on('change', (change) => {
  positionCount += 1;
  const pendingChange: PendingChange = {
    change,
    detectedAt: change.detectedAt,
  };

  const match = findMatchingTrade(change);
  if (match) {
    recordMatch(match, pendingChange);
  } else {
    pendingChanges.push(pendingChange);
  }

  trimPending();
});

const shutdown = async (): Promise<void> => {
  console.log('\nStopping pollers...');
  positionPoller.stop();
  activityPoller.stop();

  const avgDelta = matchedCount > 0 ? sumDeltaMs / matchedCount : 0;
  console.log('\n=== /positions vs /activity Summary ===');
  console.log(`Activity trades detected: ${activityCount}`);
  console.log(`Position changes detected: ${positionCount}`);
  console.log(`Matched events: ${matchedCount}`);
  if (matchedCount > 0) {
    console.log(`Avg positions - activity delta: ${formatMs(avgDelta)}`);
    console.log(`Min delta: ${formatMs(minDeltaMs)} | Max delta: ${formatMs(maxDeltaMs)}`);
  }
  console.log('Note: position latency uses activity trade timestamp and assumes clocks are in sync.');

  process.exit(0);
};

process.on('SIGINT', () => {
  shutdown().catch((error) => {
    console.error('Failed to shut down cleanly:', error);
    process.exit(1);
  });
});

console.log('=== /positions vs /activity detection comparison ===');
console.log(`Trader: ${traderAddress}`);
console.log(`Positions interval: ${positionIntervalMs}ms`);
console.log(`Activity interval: ${activityIntervalMs}ms`);
console.log(`Match tolerance: ${matchTolerance}`);
console.log(`Max runtime: ${maxRuntimeMs}ms`);
console.log('Press Ctrl+C to stop early.\n');

Promise.all([positionPoller.start(), activityPoller.start()])
  .then(() => {
    setTimeout(() => {
      shutdown().catch((error) => {
        console.error('Failed to shut down cleanly:', error);
        process.exit(1);
      });
    }, maxRuntimeMs);
  })
  .catch((error) => {
    console.error('Failed to start pollers:', error);
    process.exit(1);
  });
