#!/usr/bin/env node

/**
 * Clock Synchronization Checker
 *
 * Verifies that your system clock is synchronized with Polymarket's servers.
 * This is critical for accurate latency measurements in copy trading.
 *
 * Usage: node check-clock-sync.js
 */

async function checkClockSync() {
  try {
    const localBefore = Date.now();

    // Fetch from Polymarket API
    const response = await fetch('https://data-api.polymarket.com/activity?limit=1');

    const localAfter = Date.now();
    const serverDateHeader = response.headers.get('date');

    if (!serverDateHeader) {
      console.error('❌ Error: No Date header in response');
      return;
    }

    const polymarketTime = new Date(serverDateHeader).getTime();
    const localAvg = (localBefore + localAfter) / 2; // Adjust for network RTT
    const networkLatency = localAfter - localBefore;
    const drift = localAvg - polymarketTime;

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║         CLOCK SYNCHRONIZATION CHECK                        ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Your System Time:       ${new Date(localBefore).toISOString()}  ║`);
    console.log(`║  Polymarket Server:      ${new Date(polymarketTime).toISOString()}  ║`);
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Network Latency:        ${networkLatency.toString().padStart(4)}ms                             ║`);
    console.log(`║  Clock Drift:            ${drift >= 0 ? '+' : ''}${drift.toFixed(1).padStart(5)}ms                           ║`);
    console.log('╠════════════════════════════════════════════════════════════╣');

    if (Math.abs(drift) < 100) {
      console.log('║  Status: ✅ SYNCHRONIZED                                   ║');
      console.log('║                                                            ║');
      console.log('║  Your detection latency measurements are RELIABLE.        ║');
      console.log('║  Clock drift is within acceptable range.                  ║');
    } else if (Math.abs(drift) < 500) {
      console.log('║  Status: ⚠️  WARNING - Moderate Drift                      ║');
      console.log('║                                                            ║');
      console.log(`║  Detection latency may be off by ~${Math.abs(drift).toFixed(0)}ms            ║`);
      console.log('║  Consider syncing your system clock with NTP.             ║');
    } else if (Math.abs(drift) < 2000) {
      console.log('║  Status: ⚠️  WARNING - Significant Drift                   ║');
      console.log('║                                                            ║');
      console.log(`║  Detection latency is off by ~${Math.abs(drift).toFixed(0)}ms!              ║`);
      console.log('║  ACTION REQUIRED: Sync your system clock with NTP         ║');
    } else {
      console.log('║  Status: ❌ CRITICAL - Clock Desynchronized                ║');
      console.log('║                                                            ║');
      console.log(`║  Clock drift: ${drift >= 0 ? '+' : ''}${(drift/1000).toFixed(1)}s                                      ║`);
      console.log('║  Detection latency measurements are UNRELIABLE!           ║');
      console.log('║  URGENT: Fix system clock before using latency data       ║');
    }

    console.log('╚════════════════════════════════════════════════════════════╝');

    // Additional diagnostics
    if (Math.abs(drift) >= 100) {
      console.log('');
      console.log('How to fix:');
      console.log('  Linux/Mac:   sudo ntpdate -s time.nist.gov');
      console.log('  Or:          timedatectl set-ntp true');
      console.log('  Docker:      Use --cap-add SYS_TIME or sync host clock');
      console.log('');
      console.log('Then run this script again to verify.');
    }

    // Return drift for programmatic use
    return { drift, networkLatency, synchronized: Math.abs(drift) < 100 };

  } catch (error) {
    console.error('❌ Error checking clock sync:', error.message);
    console.error('');
    console.error('Possible causes:');
    console.error('  - No internet connection');
    console.error('  - Polymarket API is down');
    console.error('  - Network firewall blocking requests');
    return null;
  }
}

// Run if called directly
if (require.main === module) {
  checkClockSync().then(result => {
    if (result && !result.synchronized) {
      process.exit(1); // Exit with error if not synchronized
    }
  });
}

module.exports = { checkClockSync };
