# Clock Synchronization

## Overview

The copy trading bot includes automatic clock synchronization testing to ensure accurate latency measurements. This is critical because:

- **Detection latency** is calculated as: `Date.now() - trade.timestamp`
- If your system clock is out of sync with Polymarket's servers, measurements will be inaccurate
- Even a 500ms clock drift can make your bot appear much faster or slower than it actually is

## How It Works

### Automatic Testing on Startup

When you run `npm start`, the bot automatically:

1. **Fetches time from Polymarket servers** via HTTP Date header
2. **Compares with your local system time**
3. **Adjusts for network latency** (round-trip time)
4. **Calculates clock drift** in milliseconds
5. **Displays results** with clear warnings if needed

### Example Startup Output

```
╔═══════════════════════════════════════════════════════════╗
║          POLYMARKET COPY TRADING BOT v2.0                 ║
╚═══════════════════════════════════════════════════════════╝

  Mode:            PAPER
  Trader:          0xabcd1234...
  Polling Method:  ACTIVITY
  Poll Interval:   1000ms
  ...

  --- Startup Tests ---
  Clock Sync:       ✅ SYNCHRONIZED (drift: +12.3ms)
  API Connectivity: ✅ OK

Press Ctrl+C to stop
```

## Drift Thresholds

| Drift | Status | Description |
|-------|--------|-------------|
| < 100ms | ✅ **Synchronized** | Latency measurements are reliable |
| 100-500ms | ⚠️ **Warning** | Measurements may be off by ~100-500ms |
| 500-2000ms | ⚠️ **Significant Drift** | Action required: Sync your clock |
| > 2000ms | ❌ **Critical** | Measurements are unreliable! |

## Fixing Clock Drift

### Linux/macOS

```bash
# One-time sync
sudo ntpdate -s time.nist.gov

# Or enable persistent NTP
sudo timedatectl set-ntp true

# Verify
timedatectl status
```

### Docker

If running in Docker:

```bash
# Ensure host system clock is synced first
sudo timedatectl set-ntp true

# Then run container with time sync capability
docker run --cap-add SYS_TIME your-image

# Or use host network (inherits host time)
docker run --network host your-image
```

### Verify Fix

After syncing your clock, run:

```bash
node check-clock-sync.js
```

You should see:

```
╔════════════════════════════════════════════════════════════╗
║         CLOCK SYNCHRONIZATION CHECK                        ║
╠════════════════════════════════════════════════════════════╣
║  Your System Time:       2026-01-25T15:52:35.123Z          ║
║  Polymarket Server:      2026-01-25T15:52:35.120Z          ║
╠════════════════════════════════════════════════════════════╣
║  Network Latency:          45ms                            ║
║  Clock Drift:             +3.0ms                           ║
╠════════════════════════════════════════════════════════════╣
║  Status: ✅ SYNCHRONIZED                                   ║
║                                                            ║
║  Your detection latency measurements are RELIABLE.        ║
║  Clock drift is within acceptable range.                  ║
╚════════════════════════════════════════════════════════════╝
```

## Standalone Testing

You can check clock sync without starting the bot:

```bash
# Quick check
node check-clock-sync.js

# Compare with manual check
date -u && curl -sI https://data-api.polymarket.com/activity?limit=1 | grep "^date:"
```

## What Polymarket Syncs To

Polymarket's servers use:
- **Protocol**: NTP (Network Time Protocol)
- **Timezone**: UTC
- **Accuracy**: ±10-50ms typical for cloud servers
- **Source**: AWS/GCP NTP servers → Stratum 1 servers → Atomic clocks

## Why This Matters

### Example Impact of Clock Drift

**Scenario: Your clock is 500ms behind**

```
Real Timeline:
00:00.000 - Trader's order fills
00:00.200 - You detect it (actual detection latency: 200ms)

What Your Bot Measures:
Your clock reads: 23:59.700 (500ms behind)
Detection latency = 23:59.700 - 00:00.000 = -300ms ❌

Result: Negative latency! Measurements are completely wrong.
```

**With Synchronized Clock:**

```
Real Timeline:
00:00.000 - Trader's order fills
00:00.200 - You detect it

What Your Bot Measures:
Your clock reads: 00:00.200 (synchronized)
Detection latency = 00:00.200 - 00:00.000 = 200ms ✅

Result: Accurate measurement!
```

## Technical Details

### Implementation

The clock sync check is implemented in:
- `src/api/polymarket-api.ts` - `checkClockSync()` method
- `src/index.ts` - `runStartupTests()` method
- `check-clock-sync.js` - Standalone testing script

### Calculation

```typescript
const localBefore = Date.now();
const response = await fetch(polymarketUrl);
const localAfter = Date.now();
const serverTime = new Date(response.headers.get('date'));

// Adjust for network round-trip
const localAvg = (localBefore + localAfter) / 2;
const drift = localAvg - serverTime.getTime();
```

This accounts for:
- Network latency (half of round-trip time)
- Server processing time
- Your local clock offset

## Best Practices

1. ✅ **Always check on startup** - The bot does this automatically
2. ✅ **Enable NTP** - Keeps your clock synchronized 24/7
3. ✅ **Check periodically** - If running for days, verify occasionally
4. ✅ **Monitor warnings** - Pay attention to drift warnings
5. ✅ **Fix drift immediately** - Don't trade with unreliable measurements

## Troubleshooting

### "Unable to check" error

**Cause**: Network connectivity issue

**Fix**:
```bash
# Test connectivity
curl -I https://data-api.polymarket.com/activity?limit=1

# Check if you can reach internet
ping -c 3 google.com
```

### Persistent drift after sync

**Cause**: System not using NTP properly

**Fix**:
```bash
# Verify NTP is enabled
timedatectl status | grep "NTP service"

# If not, enable it
sudo timedatectl set-ntp true

# Restart NTP service
sudo systemctl restart systemd-timesyncd
```

### Clock keeps drifting

**Cause**: Hardware clock issues or no NTP daemon

**Fix**:
```bash
# Install NTP daemon
sudo apt-get install ntp

# Enable automatic sync
sudo systemctl enable ntp
sudo systemctl start ntp
```

## FAQ

**Q: Why is drift sometimes negative?**
A: Negative drift means your clock is ahead of Polymarket's servers. Both positive and negative drift indicate unsynchronized clocks.

**Q: Is 50ms drift acceptable?**
A: Yes, anything under 100ms is considered synchronized and won't significantly impact trading decisions.

**Q: Does this slow down startup?**
A: No, the check adds only ~50-200ms to startup time (one API call).

**Q: Can I disable this check?**
A: Not recommended. Accurate timing is critical for copy trading. If you must, comment out the `runStartupTests()` call in `src/index.ts`.

**Q: What if I'm in a different timezone?**
A: Timezone doesn't matter. Both your system and Polymarket use UTC internally. `Date.now()` returns milliseconds since Unix epoch, which is timezone-independent.

## Summary

✅ **Automatic clock sync testing is now part of `npm start`**
✅ **Ensures your latency measurements are accurate**
✅ **Displays clear warnings if action needed**
✅ **Easy to fix with standard NTP tools**

Your bot will now tell you exactly if your clock is synchronized before you start trading!
