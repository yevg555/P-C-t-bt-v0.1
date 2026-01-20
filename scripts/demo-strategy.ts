/**
 * DEMO: COPY TRADING WITH LATENCY MEASUREMENT
 * ============================================
 *
 * Measures time from trade detection to order ready:
 *   - t0: Trade detected (position change)
 *   - t1: Price fetched
 *   - t2: Size calculated
 *   - t3: Risk checked
 *   - t4: Order ready (Phase 3)
 *
 * Run with: npm run demo:strategy
 */

import * as dotenv from "dotenv";
import { PositionPoller } from "../src/polling/position-poller";
import { PolymarketAPI } from "../src/api/polymarket-api";
import { RiskChecker, TradingState } from "../src/strategy/risk-checker";
import { PriceAdjuster } from "../src/strategy/price-adjuster";
import { PositionChange, RiskConfig, Position } from "../src/types";

dotenv.config();

// ============================================
// CONFIGURATION
// ============================================

const TRADER_ADDRESS = process.env.TRADER_ADDRESS || "";
const POLLING_INTERVAL_MS = parseInt(process.env.POLLING_INTERVAL_MS || "1000");
const MAX_CONSECUTIVE_ERRORS = parseInt(
  process.env.MAX_CONSECUTIVE_ERRORS || "5",
);

const YOUR_BALANCE = parseFloat(process.env.YOUR_BALANCE || "1000");
const PRICE_OFFSET_BPS = parseInt(process.env.PRICE_OFFSET_BPS || "50");
const MIN_ORDER_SIZE = parseFloat(process.env.MIN_ORDER_SIZE || "10");
const MAX_POSITION_PER_TOKEN = parseFloat(
  process.env.MAX_POSITION_PER_TOKEN || "500",
);

// TEST_MODE=true ignores minimum order sizes (for testing the full flow)
const TEST_MODE = process.env.TEST_MODE === "true";

const RISK_CONFIG: RiskConfig = {
  maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || "50"),
  maxTotalLoss: parseFloat(process.env.MAX_TOTAL_LOSS || "200"),
};

// ============================================
// STATE
// ============================================

const tradingState: TradingState = {
  dailyPnL: 0,
  totalPnL: 0,
  balance: YOUR_BALANCE,
  positions: new Map(),
  totalShares: 0,
};

let latestPositions: Position[] = [];
let pollCount = 0;

// Timing stats
interface TimingRecord {
  tradeDetected: number;
  priceFetched: number;
  sizeCalculated: number;
  riskChecked: number;
  orderReady: number;

  // Durations (ms)
  priceFetchDuration: number;
  sizeCalcDuration: number;
  riskCheckDuration: number;
  totalDuration: number;
}

const timingRecords: TimingRecord[] = [];

// Trade records
interface TradeRecord {
  time: Date;
  side: "BUY" | "SELL";
  traderShares: number;
  traderTradeValue: number;
  traderPortfolioValue: number;
  traderTradePercent: number;
  executionPrice: number;
  priceSource: string;
  tokenId: string;
  marketTitle?: string;
  outcome?: string;
  copyShares: number;
  copyCost: number;
  status: string;
  timing: TimingRecord;
}

const detectedTrades: TradeRecord[] = [];

// Poll timing
const pollTimings: number[] = [];

// ALL timing records (including skipped trades)
const allTimings: { priceFetch: number; skipped: boolean; reason?: string }[] =
  [];

// ============================================
// HELPERS
// ============================================

function recordSkippedTrade(
  detectionTime: Date,
  change: PositionChange,
  position: Position | undefined,
  traderPortfolioValue: number,
  executionPrice: number,
  priceSource: string,
  skipReason: string,
  priceFetchDuration: number,
) {
  allTimings.push({
    priceFetch: priceFetchDuration,
    skipped: true,
    reason: skipReason,
  });

  detectedTrades.push({
    time: detectionTime,
    side: change.side,
    traderShares: change.delta,
    traderTradeValue: change.delta * executionPrice,
    traderPortfolioValue,
    traderTradePercent:
      traderPortfolioValue > 0
        ? ((change.delta * executionPrice) / traderPortfolioValue) * 100
        : 0,
    executionPrice,
    priceSource,
    tokenId: change.tokenId,
    marketTitle: change.marketTitle,
    outcome: position?.outcome,
    copyShares: 0,
    copyCost: 0,
    status: `⏭️ ${skipReason}`,
    timing: {
      tradeDetected: 0,
      priceFetched: 0,
      sizeCalculated: 0,
      riskChecked: 0,
      orderReady: 0,
      priceFetchDuration,
      sizeCalcDuration: 0,
      riskCheckDuration: 0,
      totalDuration: priceFetchDuration,
    },
  });
}

function calculateTraderPortfolioValue(positions: Position[]): number {
  let totalValue = 0;
  for (const pos of positions) {
    const price =
      pos.curPrice && pos.curPrice > 0 ? pos.curPrice : pos.avgPrice;
    totalValue += pos.quantity * price;
  }
  return totalValue;
}

function calculateCopySize(
  traderShares: number,
  executionPrice: number,
  traderPortfolioValue: number,
  yourBalance: number,
): { shares: number; cost: number; traderTradePercent: number } {
  const traderTradeValue = traderShares * executionPrice;
  const traderTradePercent =
    traderPortfolioValue > 0
      ? (traderTradeValue / traderPortfolioValue) * 100
      : 0;
  const yourTradeValue = yourBalance * (traderTradePercent / 100);
  const yourShares = executionPrice > 0 ? yourTradeValue / executionPrice : 0;

  return { shares: yourShares, cost: yourTradeValue, traderTradePercent };
}

// ============================================
// MAIN
// ============================================

async function main() {
  console.log(
    "╔═══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║   COPY TRADING BOT - WITH LATENCY MEASUREMENT                 ║",
  );
  console.log(
    "╚═══════════════════════════════════════════════════════════════╝\n",
  );

  if (!TRADER_ADDRESS || TRADER_ADDRESS.startsWith("0x00000")) {
    console.error("❌ Please set TRADER_ADDRESS in .env");
    process.exit(1);
  }

  console.log("📋 CONFIGURATION:");
  console.log("─".repeat(60));
  console.log(`   Trader:           ${TRADER_ADDRESS.slice(0, 20)}...`);
  console.log(`   Poll Interval:    ${POLLING_INTERVAL_MS}ms`);
  console.log(`   Your Balance:     $${YOUR_BALANCE.toFixed(2)}`);
  console.log(`   Min Order Size:   ${MIN_ORDER_SIZE} shares`);
  if (TEST_MODE) {
    console.log(`   TEST MODE:        🧪 ENABLED (ignoring minimums)`);
  }
  console.log("─".repeat(60));
  console.log("");
  console.log("⏱️  LATENCY TRACKING ENABLED");
  console.log("   Will measure: Detection → Price → Size → Risk → Ready");
  console.log("");

  const api = new PolymarketAPI();
  const riskChecker = new RiskChecker(RISK_CONFIG);
  const priceAdjuster = new PriceAdjuster(PRICE_OFFSET_BPS);

  const poller = new PositionPoller({
    traderAddress: TRADER_ADDRESS,
    intervalMs: POLLING_INTERVAL_MS,
    maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
  });

  // Track poll timing
  poller.on("poll", (positions: Position[]) => {
    const pollTime = Date.now();
    latestPositions = positions;
    pollCount++;

    // Log every 60 polls
    if (pollCount % 60 === 0) {
      const portfolioValue = calculateTraderPortfolioValue(positions);
      console.log(
        `[${new Date().toLocaleTimeString()}] Poll #${pollCount} | Portfolio: $${portfolioValue.toFixed(2)} | ${positions.length} positions`,
      );
    }
  });

  // Handle trades with timing
  poller.on("change", async (change: PositionChange) => {
    // ═══════════════════════════════════════════════════════════════
    // T0: TRADE DETECTED
    // ═══════════════════════════════════════════════════════════════
    const t0 = performance.now();
    const detectionTime = new Date();

    console.log("\n" + "═".repeat(70));
    console.log("🔔 TRADE DETECTED");
    console.log("═".repeat(70));
    console.log(
      `   ⏱️  T0 (Detection): ${detectionTime.toLocaleTimeString()}.${detectionTime.getMilliseconds().toString().padStart(3, "0")}`,
    );

    // Trade info
    console.log("\n📍 TRADER ACTION:");
    console.log(
      `   Side:             ${change.side === "BUY" ? "🟢 BUY" : "🔴 SELL"}`,
    );
    console.log(`   Shares:           ${change.delta.toFixed(6)}`);
    console.log(
      `   Position:         ${change.previousQuantity.toFixed(2)} → ${change.currentQuantity.toFixed(2)}`,
    );
    if (change.marketTitle) {
      console.log(`   Market:           ${change.marketTitle}`);
    }
    console.log(`   Token ID:         ${change.tokenId}`);

    // Position data
    const position = latestPositions.find((p) => p.tokenId === change.tokenId);
    const traderPortfolioValue = calculateTraderPortfolioValue(latestPositions);

    console.log("\n📊 CONTEXT:");
    console.log(
      `   curPrice:         $${(position?.curPrice || 0).toFixed(6)}`,
    );
    console.log(
      `   avgPrice:         $${(position?.avgPrice || 0).toFixed(6)}`,
    );
    console.log(`   Portfolio Value:  $${traderPortfolioValue.toFixed(2)}`);

    // ═══════════════════════════════════════════════════════════════
    // T1: FETCH EXECUTION PRICE
    // ═══════════════════════════════════════════════════════════════
    console.log("\n⏱️  FETCHING PRICE...");
    const priceStart = performance.now();

    let executionPrice = 0;
    let priceSource = "";

    try {
      executionPrice = await api.getPrice(change.tokenId, change.side);
      priceSource = `/price?side=${change.side === "BUY" ? "SELL" : "BUY"}`;
    } catch (error) {
      console.log(`   ⚠️ Price API failed: ${error}`);

      // Fallback to curPrice
      if (position?.curPrice && position.curPrice > 0) {
        executionPrice = position.curPrice;
        priceSource = "curPrice (fallback)";
      }
    }

    const t1 = performance.now();
    const priceFetchDuration = t1 - priceStart;

    console.log(
      `   ⏱️  T1 (Price fetched): +${priceFetchDuration.toFixed(0)}ms`,
    );
    console.log(`   Price: $${executionPrice.toFixed(6)} (${priceSource})`);

    // Validate price
    if (executionPrice <= 0 || executionPrice >= 1) {
      console.log(`\n⏭️  SKIPPING: Invalid price`);
      recordSkippedTrade(
        detectionTime,
        change,
        position,
        traderPortfolioValue,
        executionPrice,
        priceSource,
        "Invalid price",
        priceFetchDuration,
      );
      return;
    }

    // Skip SELL for now (but record timing)
    if (change.side === "SELL") {
      console.log(`\n⏭️  SKIPPING: SELL not implemented`);
      recordSkippedTrade(
        detectionTime,
        change,
        position,
        traderPortfolioValue,
        executionPrice,
        priceSource,
        "SELL not implemented",
        priceFetchDuration,
      );
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // T2: CALCULATE SIZE
    // ═══════════════════════════════════════════════════════════════
    const sizeStart = performance.now();

    const traderTradeValue = change.delta * executionPrice;
    const sizeResult = calculateCopySize(
      change.delta,
      executionPrice,
      traderPortfolioValue,
      tradingState.balance,
    );

    let finalShares = sizeResult.shares;
    const adjustments: string[] = [];

    if (!TEST_MODE && finalShares < MIN_ORDER_SIZE && finalShares > 0) {
      adjustments.push(
        `Below min (${finalShares.toFixed(2)} < ${MIN_ORDER_SIZE})`,
      );
      finalShares = 0;
    }
    if (finalShares > MAX_POSITION_PER_TOKEN) {
      adjustments.push(`Capped at ${MAX_POSITION_PER_TOKEN}`);
      finalShares = MAX_POSITION_PER_TOKEN;
    }
    finalShares = Math.floor(finalShares * 100) / 100;

    // In test mode, ensure we have at least a tiny amount
    if (TEST_MODE && finalShares === 0 && sizeResult.shares > 0) {
      finalShares = 0.01; // Minimum test amount
      adjustments.push("TEST_MODE: Using minimum 0.01");
    }

    const t2 = performance.now();
    const sizeCalcDuration = t2 - sizeStart;

    console.log(
      `\n⏱️  T2 (Size calculated): +${sizeCalcDuration.toFixed(0)}ms`,
    );
    console.log(
      `   Trader: ${sizeResult.traderTradePercent.toFixed(4)}% of portfolio`,
    );
    console.log(
      `   You: ${finalShares.toFixed(2)} shares ($${sizeResult.cost.toFixed(2)})`,
    );
    if (adjustments.length > 0) {
      console.log(`   Adjustments: ${adjustments.join(", ")}`);
    }

    if (finalShares === 0) {
      console.log(`\n⏭️  SKIPPING: Size = 0 after adjustments`);
      recordSkippedTrade(
        detectionTime,
        change,
        position,
        traderPortfolioValue,
        executionPrice,
        priceSource,
        `Size too small (${sizeResult.shares.toFixed(4)} < ${MIN_ORDER_SIZE})`,
        priceFetchDuration,
      );
      return;
    }

    // ═══════════════════════════════════════════════════════════════
    // T3: RISK CHECK
    // ═══════════════════════════════════════════════════════════════
    const riskStart = performance.now();

    const orderPrice = priceAdjuster.adjust(executionPrice, change.side);
    const orderSpec = {
      tokenId: change.tokenId,
      side: change.side,
      size: finalShares,
      price: orderPrice,
    };

    const riskResult = riskChecker.check(orderSpec, tradingState);

    const t3 = performance.now();
    const riskCheckDuration = t3 - riskStart;

    console.log(`\n⏱️  T3 (Risk checked): +${riskCheckDuration.toFixed(0)}ms`);
    console.log(
      `   Status: ${riskResult.approved ? "✅ APPROVED" : "❌ REJECTED"}`,
    );

    // ═══════════════════════════════════════════════════════════════
    // T4: ORDER READY
    // ═══════════════════════════════════════════════════════════════
    const t4 = performance.now();
    const totalDuration = t4 - t0;

    const timing: TimingRecord = {
      tradeDetected: t0,
      priceFetched: t1,
      sizeCalculated: t2,
      riskChecked: t3,
      orderReady: t4,
      priceFetchDuration,
      sizeCalcDuration,
      riskCheckDuration,
      totalDuration,
    };

    timingRecords.push(timing);
    allTimings.push({ priceFetch: priceFetchDuration, skipped: false });

    // ═══════════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════════
    console.log("\n" + "─".repeat(70));
    console.log("⏱️  LATENCY BREAKDOWN:");
    console.log("─".repeat(70));
    console.log(
      `   T0 → T1 (Price fetch):  ${priceFetchDuration.toFixed(0)}ms`,
    );
    console.log(`   T1 → T2 (Size calc):    ${sizeCalcDuration.toFixed(0)}ms`);
    console.log(`   T2 → T3 (Risk check):   ${riskCheckDuration.toFixed(0)}ms`);
    console.log("   ────────────────────────────────");
    console.log(`   TOTAL (T0 → T4):        ${totalDuration.toFixed(0)}ms`);
    console.log("─".repeat(70));

    if (riskResult.approved) {
      const finalCost = finalShares * orderPrice;

      console.log("\n📋 ORDER READY FOR PHASE 3:");
      console.log(
        `   ${change.side} ${finalShares.toFixed(2)} shares @ $${orderPrice.toFixed(4)}`,
      );
      console.log(`   Total: $${finalCost.toFixed(2)}`);
      console.log(`   Latency: ${totalDuration.toFixed(0)}ms ⚡`);

      // Update balance
      tradingState.balance -= finalCost;

      detectedTrades.push({
        time: detectionTime,
        side: change.side,
        traderShares: change.delta,
        traderTradeValue,
        traderPortfolioValue,
        traderTradePercent: sizeResult.traderTradePercent,
        executionPrice,
        priceSource,
        tokenId: change.tokenId,
        marketTitle: change.marketTitle,
        outcome: position?.outcome,
        copyShares: finalShares,
        copyCost: finalCost,
        status: "✅ Ready",
        timing,
      });
    }

    console.log("═".repeat(70));
  });

  await poller.start();

  // Show initial info
  setTimeout(() => {
    const portfolioValue = calculateTraderPortfolioValue(latestPositions);
    console.log(
      `\n📊 Trader Portfolio: $${portfolioValue.toFixed(2)} (${latestPositions.length} positions)`,
    );
    console.log("\n🚀 Monitoring for trades... (Ctrl+C to stop)\n");
  }, 2000);

  // Shutdown handler
  process.on("SIGINT", () => {
    console.log("\n");
    poller.stop();
    printSummary();
    process.exit(0);
  });
}

function printSummary() {
  console.log("\n" + "═".repeat(70));
  console.log("📊 SESSION SUMMARY");
  console.log("═".repeat(70));

  console.log(`\n📡 Polls: ${pollCount}`);
  console.log(`🔔 Trades Detected: ${detectedTrades.length}`);

  // Show timing for ALL trades (including skipped)
  if (allTimings.length > 0) {
    console.log("\n⏱️  LATENCY STATISTICS (ALL TRADES):");
    console.log("─".repeat(50));

    const priceFetchTimes = allTimings.map((t) => t.priceFetch);
    const avgPriceFetch =
      priceFetchTimes.reduce((a, b) => a + b, 0) / priceFetchTimes.length;
    const minPriceFetch = Math.min(...priceFetchTimes);
    const maxPriceFetch = Math.max(...priceFetchTimes);

    console.log(`   Trades measured:    ${allTimings.length}`);
    console.log(`   Price Fetch Time:`);
    console.log(`     Average:          ${avgPriceFetch.toFixed(0)}ms`);
    console.log(`     Min:              ${minPriceFetch.toFixed(0)}ms`);
    console.log(`     Max:              ${maxPriceFetch.toFixed(0)}ms`);

    // Show skipped vs executed
    const skipped = allTimings.filter((t) => t.skipped).length;
    const executed = allTimings.filter((t) => !t.skipped).length;
    console.log(`\n   Executed:           ${executed}`);
    console.log(`   Skipped:            ${skipped}`);
  }

  // Full latency for executed trades only
  if (timingRecords.length > 0) {
    console.log("\n⏱️  FULL LATENCY (EXECUTED TRADES ONLY):");
    console.log("─".repeat(50));

    const avgPriceFetch =
      timingRecords.reduce((sum, t) => sum + t.priceFetchDuration, 0) /
      timingRecords.length;
    const avgSizeCalc =
      timingRecords.reduce((sum, t) => sum + t.sizeCalcDuration, 0) /
      timingRecords.length;
    const avgRiskCheck =
      timingRecords.reduce((sum, t) => sum + t.riskCheckDuration, 0) /
      timingRecords.length;
    const avgTotal =
      timingRecords.reduce((sum, t) => sum + t.totalDuration, 0) /
      timingRecords.length;

    const minTotal = Math.min(...timingRecords.map((t) => t.totalDuration));
    const maxTotal = Math.max(...timingRecords.map((t) => t.totalDuration));

    console.log(`   Price Fetch:    avg ${avgPriceFetch.toFixed(0)}ms`);
    console.log(`   Size Calc:      avg ${avgSizeCalc.toFixed(0)}ms`);
    console.log(`   Risk Check:     avg ${avgRiskCheck.toFixed(0)}ms`);
    console.log("   ────────────────────────────────");
    console.log(
      `   TOTAL:          avg ${avgTotal.toFixed(0)}ms (min: ${minTotal.toFixed(0)}ms, max: ${maxTotal.toFixed(0)}ms)`,
    );
  }

  // Trade details
  if (detectedTrades.length > 0) {
    console.log("\n🔔 TRADE DETAILS:");
    console.log("─".repeat(50));

    for (let i = 0; i < detectedTrades.length; i++) {
      const t = detectedTrades[i];
      console.log(`\n#${i + 1} ${t.marketTitle || "Unknown"}`);
      console.log(`   Time:     ${t.time.toLocaleTimeString()}`);
      console.log(
        `   Trader:   ${t.side} ${t.traderShares.toFixed(2)} @ $${t.executionPrice.toFixed(4)}`,
      );
      console.log(
        `   Value:    $${t.traderTradeValue.toFixed(2)} (${t.traderTradePercent.toFixed(4)}% of portfolio)`,
      );
      console.log(
        `   Latency:  ${t.timing.priceFetchDuration.toFixed(0)}ms (price fetch)`,
      );
      console.log(`   Status:   ${t.status}`);
      if (t.copyShares > 0) {
        console.log(
          `   Copy:     ${t.copyShares.toFixed(2)} shares = $${t.copyCost.toFixed(2)}`,
        );
      }
    }

    const executed = detectedTrades.filter((t) => t.copyShares > 0);
    const totalInvested = executed.reduce((sum, t) => sum + t.copyCost, 0);

    console.log("\n" + "─".repeat(50));
    console.log(
      `Executed:       ${executed.length} / ${detectedTrades.length} trades`,
    );
    console.log(`Total Invested: $${totalInvested.toFixed(2)}`);
    console.log(`Final Balance:  $${tradingState.balance.toFixed(2)}`);
  }

  console.log("\n" + "═".repeat(70));
}

main().catch(console.error);
