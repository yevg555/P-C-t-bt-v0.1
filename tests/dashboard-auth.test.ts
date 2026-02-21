import { DashboardServer, DashboardBotInterface } from '../src/dashboard/server';
import { OrderExecutor } from '../src/types';
import { TradeStore } from '../src/storage';
import http from 'http';
import WebSocket from 'ws';

// Mock dependencies
const mockExecutor = {
  getBalance: async () => ({ total: 1000, available: 1000 }),
  getMode: () => 'paper',
  getSpendTracker: () => undefined,
  getAllPositionDetails: async () => new Map(),
} as unknown as OrderExecutor;

const mockStore = {
  getTrades: () => [],
  getTradeCount: () => 0,
  getSessions: () => [],
  getPerformanceSummary: () => ({}),
  getPnlByToken: () => ({}),
  getAdvancedAnalytics: () => ({}),
} as unknown as TradeStore;

const mockBot: DashboardBotInterface = {
  getStats: () => ({
    pollerStats: {},
    tradeCount: 0,
    totalPnL: 0,
    dailyPnL: 0,
    mode: 'paper',
    pollingMethod: 'activity',
    latencyStats: { avgDetectionMs: 0, avgExecutionMs: 0, avgTotalMs: 0, sampleCount: 0, clockDriftOffset: 0 },
  }),
  getExecutor: () => mockExecutor,
  getTradeStore: () => mockStore,
};

const PORT = 3457; // Use a different port to avoid conflicts
const USERNAME = 'admin';
const PASSWORD = 'password123';

// Set environment variables for the test
process.env.DASHBOARD_USERNAME = USERNAME;
process.env.DASHBOARD_PASSWORD = PASSWORD;
process.env.DASHBOARD_PORT = String(PORT);

async function runTest() {
  console.log('🔒 Starting Dashboard Auth Test...');

  const server = new DashboardServer(mockBot, PORT);
  await server.start();

  let failed = false;

  try {
    // 1. Test Unauthenticated HTTP Access
    console.log('Testing Unauthenticated HTTP Access...');
    await new Promise<void>((resolve, reject) => {
      http.get(`http://localhost:${PORT}/`, (res) => {
        if (res.statusCode === 401) {
          console.log('✅ Unauthenticated HTTP request rejected (401)');
          resolve();
        } else {
          console.error(`❌ Unauthenticated HTTP request failed: expected 401, got ${res.statusCode}`);
          failed = true;
          resolve();
        }
      }).on('error', reject);
    });

    // 2. Test Unauthenticated WebSocket Access
    console.log('Testing Unauthenticated WebSocket Access...');
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/`);
      ws.on('open', () => {
        console.error('❌ Unauthenticated WebSocket connection opened (should be rejected)');
        failed = true;
        ws.close();
        resolve();
      });
      ws.on('error', (err: any) => {
        // ws client emits error on 401 during upgrade
        if (err.message.includes('401')) {
             console.log('✅ Unauthenticated WebSocket connection rejected (401)');
        } else {
             console.log(`✅ Unauthenticated WebSocket connection rejected (${err.message})`);
        }
        resolve();
      });
    });

    // 3. Test Authenticated HTTP Access
    console.log('Testing Authenticated HTTP Access...');
    const authHeader = 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
    await new Promise<void>((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/',
        headers: { 'Authorization': authHeader }
      };
      http.get(options, (res) => {
        if (res.statusCode === 200) {
          console.log('✅ Authenticated HTTP request succeeded (200)');
          resolve();
        } else {
          console.error(`❌ Authenticated HTTP request failed: expected 200, got ${res.statusCode}`);
          failed = true;
          resolve();
        }
      }).on('error', reject);
    });

    // 4. Test Authenticated WebSocket Access
    console.log('Testing Authenticated WebSocket Access...');
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/`, {
        headers: { 'Authorization': authHeader }
      });
      ws.on('open', () => {
        console.log('✅ Authenticated WebSocket connection succeeded');
        ws.close();
        resolve();
      });
      ws.on('error', (err: any) => {
        console.error(`❌ Authenticated WebSocket connection failed: ${err.message}`);
        failed = true;
        resolve();
      });
    });

    // 5. Test Malformed Header
    console.log('Testing Malformed Header...');
    await new Promise<void>((resolve, reject) => {
      const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/',
        headers: { 'Authorization': 'Basic' } // Missing credentials
      };
      http.get(options, (res) => {
        if (res.statusCode === 401) {
          console.log('✅ Malformed header rejected (401)');
          resolve();
        } else {
          console.error(`❌ Malformed header failed: expected 401, got ${res.statusCode}`);
          failed = true;
          resolve();
        }
      }).on('error', reject);
    });

  } catch (error) {
    console.error('Test Error:', error);
    failed = true;
  } finally {
    server.stop();
  }

  if (failed) {
    console.error('❌ Test Suite Failed');
    process.exit(1);
  } else {
    console.log('✅ Test Suite Passed');
    process.exit(0);
  }
}

runTest();
