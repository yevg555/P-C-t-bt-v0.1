/**
 * DEMO: POSITION POLLER
 * =====================
 * Demonstrates the position polling system in action.
 * Watches a trader and logs any position changes.
 * 
 * Run with: npm run demo:poller
 */

import * as dotenv from 'dotenv';
import { PositionPoller } from '../src/polling/position-poller';
import { ChangeDetector } from '../src/polling/change-detector';

dotenv.config();

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   POSITION POLLER DEMO                            ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log('║   This demo watches a Polymarket trader and       ║');
  console.log('║   logs when they make trades.                     ║');
  console.log('║                                                   ║');
  console.log('║   Press Ctrl+C to stop.                           ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  
  // Get configuration
  const traderAddress = process.env.TRADER_ADDRESS;
  
  if (!traderAddress || traderAddress === '0x0000000000000000000000000000000000000000') {
    console.error('❌ ERROR: Please set TRADER_ADDRESS in .env file\n');
    console.log('Steps to fix:');
    console.log('1. Copy .env.example to .env:');
    console.log('   cp .env.example .env\n');
    console.log('2. Find a trader to copy from Polymarket leaderboard:');
    console.log('   https://polymarket.com/leaderboard\n');
    console.log('3. Add their wallet address to .env:');
    console.log('   TRADER_ADDRESS=0x...\n');
    process.exit(1);
  }
  
  // Use 1 second interval for demo (easier to observe)
  const intervalMs = parseInt(process.env.POLLING_INTERVAL_MS || '1000');
  
  console.log('Configuration:');
  console.log(`  Trader: ${traderAddress}`);
  console.log(`  Interval: ${intervalMs}ms`);
  console.log('');
  
  // Create the poller
  const poller = new PositionPoller({
    traderAddress,
    intervalMs,
    maxConsecutiveErrors: 5,
  });
  
  // Track some stats
  let changeCount = 0;
  const startTime = Date.now();
  
  // === Event Listeners ===
  
  poller.on('change', (change) => {
    changeCount++;
    
    // Format it nicely
    const formattedChange = ChangeDetector.formatChange(change);
    console.log(`\n  #${changeCount} ${formattedChange}`);
    
    // This is where you'd add your copy trading logic!
    console.log('');
    console.log('  💡 In the full bot, this would trigger a copy trade:');
    console.log(`     → Would ${change.side} ~${change.delta.toFixed(2)} shares`);
    console.log('');
  });
  
  poller.on('poll', () => {
    // Show a dot every 10 polls to indicate activity
    const stats = poller.getStats();
    if (stats.pollCount % 10 === 0) {
      process.stdout.write('.');
    }
  });
  
  poller.on('error', (error) => {
    // Errors are logged by the poller, but we can add extra handling
  });
  
  poller.on('degraded', () => {
    console.log('\n⚠️  Too many errors! Check your connection.\n');
  });
  
  // Start polling
  await poller.start();
  
  console.log('Watching for trades (. = polling):\n');
  
  // === Graceful Shutdown ===
  
  const shutdown = () => {
    console.log('\n');
    poller.stop();
    
    const stats = poller.getStats();
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    console.log('\n📊 Demo Summary:');
    console.log('─'.repeat(40));
    console.log(`  Duration: ${duration} seconds`);
    console.log(`  Polls completed: ${stats.pollCount}`);
    console.log(`  Changes detected: ${changeCount}`);
    console.log(`  Final positions tracked: ${stats.cacheSize}`);
    console.log('─'.repeat(40));
    
    if (changeCount === 0) {
      console.log('\n💡 No changes detected. This is normal if:');
      console.log('   - The trader hasn\'t made any trades');
      console.log('   - You\'re watching during off-hours');
      console.log('   - The demo ran for a short time');
      console.log('');
      console.log('   Try running for longer or during active market hours!');
    }
    
    console.log('');
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
