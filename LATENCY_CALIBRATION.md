# Automatic Latency Calibration

## Overview

The bot now includes **automatic clock drift calibration** that corrects latency measurements based on the offset between your system clock and Polymarket's servers. This ensures you always see accurate latency numbers, even if your clock isn't perfectly synchronized.

## How It Works

### 1. Measure Clock Drift on Startup

When you run `npm start`, the bot:
1. Fetches Polymarket's server time from HTTP headers
2. Compares it with your local system time
3. Adjusts for network round-trip latency
4. Calculates the **clock drift offset**
5. Stores this offset for the entire session

### 2. Apply Correction to All Measurements

Every time a trade is detected and executed:
- **Detection latency** = Raw detection time - Clock drift offset
- **Total latency** = Raw total time - Clock drift offset
- **Execution latency** = Unchanged (this is a relative duration, not affected by clock drift)

### 3. Display Calibrated Values

All latency measurements shown in logs and statistics are **automatically calibrated**.

## Example

**Your Clock Scenario:**
- Your system clock is **+26ms ahead** of Polymarket's servers
- This means your `Date.now()` returns a timestamp 26ms in the future

**Without Calibration:**
```
Trade executed on Polymarket: 16:19:49.000
You detect it at (your clock):  16:19:49.200
Raw detection latency = 200ms

But you're 26ms ahead, so actual detection latency = 200 - 26 = 174ms ✅
```

**With Automatic Calibration:**
```
╔═══════════════════════════════════════════════════════════╗
║          POLYMARKET COPY TRADING BOT v2.0                 ║
╚═══════════════════════════════════════════════════════════╝

  --- Startup Tests ---
  Clock Sync:       ✅ SYNCHRONIZED (drift: +26.0ms)
                    Auto-calibration enabled - latency adjusted by +26.0ms
  API Connectivity: ✅ OK

[TRADE DETECTED]
Detection Latency: 174ms (calibrated, raw: 200ms)

[EXEC] FILLED: 10 shares @ $0.5200
[LATENCY] Detection: 174ms | Execution: 45ms | Total: 219ms (calibrated)
```

All numbers you see are **corrected for clock drift** - showing the true latency!

## Benefits

### ✅ Accurate Measurements Even Without Perfect Clock Sync
- No need to manually sync your clock (though still recommended for large drifts)
- Works automatically on every startup
- Handles both positive and negative drift

### ✅ Consistent Over Time
- Drift offset measured at startup
- Applied consistently to all trades in that session
- Recalculated on next restart

### ✅ Transparent
- Shows both raw and calibrated values when drift > 1ms
- Displays drift offset in session summary
- Clear "(calibrated)" label so you know correction was applied

## When Calibration is Applied

| Drift | Behavior |
|-------|----------|
| < 1ms | No calibration label shown (too small to matter) |
| 1-100ms | ✅ Shows "(calibrated)" label, corrects measurements |
| 100-500ms | ⚠️ Shows warning + calibration |
| 500-2000ms | ⚠️ Calibrates but recommends syncing clock |
| > 2000ms | ❌ Calibrates but warns accuracy may suffer |

## Startup Output Examples

### Perfect Sync (drift < 10ms)
```
  Clock Sync:       ✅ SYNCHRONIZED (drift: +2.3ms)
```
No calibration message because drift is negligible.

### Minor Drift (10-100ms)
```
  Clock Sync:       ✅ SYNCHRONIZED (drift: +26.0ms)
                    Auto-calibration enabled - latency adjusted by +26.0ms
```
Calibration applied, measurements will be accurate.

### Moderate Drift (100-500ms)
```
  Clock Sync:       ⚠️  WARNING (drift: +234.5ms)
                    Auto-calibration enabled - measurements will be corrected
```
Calibration works, but you should consider syncing your clock.

### Large Drift (> 500ms)
```
  Clock Sync:       ⚠️  SIGNIFICANT DRIFT (+678.2ms)
                    Auto-calibration enabled, but recommend syncing clock
                    Run: sudo ntpdate -s time.nist.gov
```
Calibration may not be perfectly accurate - sync your clock!

## Trade Log Examples

### With Calibration (drift > 1ms)
```
[TRADE DETECTED: BUY 10.00 shares @ $0.5200]
Detection Latency: 174ms (calibrated, raw: 200ms)

[EXEC] FILLED: 10 shares @ $0.5200
[LATENCY] Detection: 174ms | Execution: 45ms | Total: 219ms (calibrated)
```

### Without Calibration (drift < 1ms)
```
[TRADE DETECTED: BUY 10.00 shares @ $0.5200]
Detection Latency: 198ms

[EXEC] FILLED: 10 shares @ $0.5200
[LATENCY] Detection: 198ms | Execution: 45ms | Total: 243ms
```

## Session Summary

At the end of your session:

```
╔═══════════════════════════════════════════════════════════╗
║               SESSION SUMMARY                             ║
╠═══════════════════════════════════════════════════════════╣
║  Polls completed:   1234                                  ║
║  Trades detected:   5                                     ║
║  Trades executed:   5                                     ║
║  Total P&L:         $12.50                                ║
║  Avg Latency:       215ms (calibrated)                    ║
║  Clock Drift:       +26.0ms corrected                     ║
╚═══════════════════════════════════════════════════════════╝
```

The summary shows:
- **Avg Latency**: Already corrected for drift
- **Clock Drift**: The offset that was applied

## Technical Details

### How Clock Drift Affects Measurements

Detection latency formula:
```typescript
// Raw calculation (what the API gives us)
detectionLatencyMs = Date.now() - trade.timestamp.getTime()
                     ^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^
                     YOUR clock     POLYMARKET's clock

// Problem: If YOUR clock is +26ms ahead:
detectionLatencyMs = (serverTime + 26) - serverTime = actualLatency + 26 ❌

// With calibration:
detectionLatencyCorrected = detectionLatencyMs - clockDriftOffset
                          = (actualLatency + 26) - 26
                          = actualLatency ✅
```

### What Gets Corrected

| Metric | Corrected? | Why |
|--------|-----------|-----|
| Detection Latency | ✅ Yes | Uses both your clock and server timestamp |
| Total Latency | ✅ Yes | Uses both your clock and server timestamp |
| Execution Latency | ❌ No | Relative duration (start to end on same clock) |

### Implementation

```typescript
// On startup - measure drift
const clockSync = await this.api.checkClockSync();
this.clockDriftOffset = clockSync.drift; // e.g., +26.0ms

// When trade is executed - apply correction
const detectionLatencyCorrected = latency.detectionLatencyMs - this.clockDriftOffset;
const totalLatencyCorrected = totalLatencyMs - this.clockDriftOffset;

// Store and display corrected values
this.recordLatencySample(detectionLatencyCorrected, executionLatencyMs, totalLatencyCorrected);
```

## Limitations

### 1. Clock Drift Can Change Over Time
- Calibration is done once on startup
- If your clock drifts during a long session, measurements may become less accurate
- Solution: Restart the bot periodically, or enable NTP for continuous sync

### 2. Network Latency Variation
- We adjust for network latency using half of round-trip time
- If network latency varies significantly, drift measurement may be off by ~10-20ms
- This is acceptable for most copy trading scenarios

### 3. Large Drift (> 2 seconds)
- Automatic calibration works best for drift < 500ms
- Very large drift may indicate system issues
- Always better to fix the underlying clock sync problem

## Best Practices

### ✅ Recommended Approach
1. **Enable automatic calibration** (already enabled by default)
2. **Check startup output** - verify drift is measured
3. **Use calibrated measurements** for decision making
4. **Sync your clock if drift > 500ms** for best accuracy

### ⚠️ When to Sync Your Clock Manually

If you see:
```
Clock Sync:       ⚠️  SIGNIFICANT DRIFT (500ms+)
```

Run:
```bash
# Linux/macOS
sudo ntpdate -s time.nist.gov

# Or enable persistent NTP
sudo timedatectl set-ntp true
```

Then restart the bot to remeasure drift.

### 🔄 Periodic Recalibration

For long-running sessions (24+ hours):
1. Restart the bot daily to remeasure drift
2. Or enable NTP for continuous clock sync
3. Monitor session summary for drift offset

## FAQ

**Q: Will this slow down trade execution?**
A: No. Calibration is a simple subtraction (< 0.001ms). Drift is measured once on startup.

**Q: What if I can't check clock sync (network error)?**
A: Calibration is disabled (offset = 0). Raw measurements are used. Bot still works normally.

**Q: Can I disable calibration?**
A: Not recommended, but you can set `this.clockDriftOffset = 0` after startup. Better to fix clock sync instead.

**Q: Does this fix my system clock?**
A: No. It only corrects the latency measurements displayed. Your system clock remains unchanged. Use NTP to actually fix your clock.

**Q: What if drift changes mid-session?**
A: Measurements will become less accurate. Restart the bot to remeasure. Or use NTP for continuous sync.

**Q: Is negative drift bad?**
A: No. Negative drift just means your clock is behind Polymarket's. Calibration works the same way.

**Q: How accurate is this?**
A: Typically within ±5-10ms for drift < 500ms. Good enough for copy trading latency analysis.

## Summary

✅ **Automatic clock drift calibration is enabled by default**
✅ **All latency measurements are corrected for clock offset**
✅ **No manual intervention needed - works automatically**
✅ **Transparent - shows both raw and calibrated values**
✅ **Accurate even without perfect clock sync**

Your latency measurements are now **always reliable**, regardless of minor clock drift!
