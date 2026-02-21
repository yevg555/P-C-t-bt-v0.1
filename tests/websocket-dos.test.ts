import { DashboardServer, DashboardBotInterface } from '../src/dashboard/server';
import { WebSocket } from 'ws';
import { OrderExecutor } from '../src/types';
import { TradeStore } from '../src/storage';

// Mock Implementation
const mockBot: DashboardBotInterface = {
  getStats: () => ({
    pollerStats: {},
    tradeCount: 0,
    totalPnL: 0,
    dailyPnL: 0,
    mode: 'test',
    pollingMethod: 'test',
    latencyStats: {
      avgDetectionMs: 0,
      avgExecutionMs: 0,
      avgTotalMs: 0,
      sampleCount: 0,
      clockDriftOffset: 0,
    },
  }),
  getExecutor: () => ({
    getBalance: async () => ({
      total: 1000,
      available: 1000,
      locked: 0,
    }),
    getAllPositionDetails: async () => new Map(),
    getMode: () => 'paper',
  } as unknown as OrderExecutor),
  getTradeStore: () => ({
    getTrades: () => [],
    getTradeCount: () => 0,
    getSessions: () => [],
    getPerformanceSummary: () => ({}),
    getPnlByToken: () => ({}),
    getAdvancedAnalytics: () => ({}),
  } as unknown as TradeStore),
};

async function runTest() {
  console.log('Starting WebSocket DoS reproduction test...');
  const server = new DashboardServer(mockBot, 3457); // Use a different port to avoid conflicts
  await server.start();

  const connections: WebSocket[] = [];
  const MAX_CLIENTS = 50;
  const ATTEMPTED_CLIENTS = 60;
  let successfulConnections = 0;
  let closedConnections = 0;

  console.log(`Attempting to open ${ATTEMPTED_CLIENTS} connections...`);

  const promises: Promise<void>[] = [];

  for (let i = 0; i < ATTEMPTED_CLIENTS; i++) {
    const promise = new Promise<void>((resolve) => {
      const ws = new WebSocket('ws://localhost:3457');
      connections.push(ws);
      let resolved = false;

      ws.on('open', () => {
        if (!resolved) {
          successfulConnections++;
          resolved = true;
          resolve(); // Resolve on open
        }
      });

      ws.on('close', () => {
        if (!resolved) {
            closedConnections++;
            resolved = true;
            resolve();
        } else {
             // Connection was open, then closed.
             // We don't resolve here as it was already resolved.
        }
      });

      ws.on('error', (err) => {
        if (!resolved) {
            // console.error(`Connection ${i} error:`, err.message);
            closedConnections++;
            resolved = true;
            resolve();
        }
      });

      // Fallback timeout
      setTimeout(() => {
          if (!resolved) {
              console.log(`Connection ${i} timed out`);
              resolved = true;
              resolve();
          }
      }, 2000);
    });
    promises.push(promise);
  }

  await Promise.all(promises);

  // Wait a bit to ensure async closes happen (the server might close connections slightly after accept)
  await new Promise(r => setTimeout(r, 1000));

  // Count active connections
  let activeConnections = 0;
  for (const ws of connections) {
      if (ws.readyState === WebSocket.OPEN) {
          activeConnections++;
      }
  }

  console.log(`Results:`);
  console.log(`Successful opens (initial): ${successfulConnections}`);
  console.log(`Active connections: ${activeConnections}`);

  // Assertions for FIXED state
  // We expect exactly 50 to stay open.
  if (activeConnections <= MAX_CLIENTS && activeConnections >= MAX_CLIENTS - 2) {
    console.log('SUCCESS: Connection limit enforced.');
  } else {
    console.log(`FAILURE: Active connections ${activeConnections} (expected <= ${MAX_CLIENTS})`);
  }

  // Cleanup
  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
  server.stop();

  if (activeConnections <= MAX_CLIENTS) {
      process.exit(0);
  } else {
      process.exit(1);
  }
}

runTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
