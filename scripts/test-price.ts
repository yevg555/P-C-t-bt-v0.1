/**
 * TEST: Price API (Fixed)
 * ========================
 * Tests the corrected price fetching logic
 *
 * API Terminology:
 *   /price?side=BUY  → Returns best BID (buyers offering)
 *   /price?side=SELL → Returns best ASK (sellers asking)
 *
 * Our Logic:
 *   getPrice(token, 'BUY')  → We want to buy → need ASK → calls side=SELL
 *   getPrice(token, 'SELL') → We want to sell → need BID → calls side=BUY
 *
 * Run with: npx ts-node scripts/test-price.ts
 */

import * as dotenv from "dotenv";
import { PolymarketAPI } from "../src/api/polymarket-api";

dotenv.config();

async function main() {
  console.log("🧪 Testing Price API (Fixed Logic)\n");

  const api = new PolymarketAPI();
  const traderAddress = process.env.TRADER_ADDRESS;

  if (!traderAddress || traderAddress.startsWith("0x00000")) {
    console.error("❌ Set TRADER_ADDRESS in .env first");
    process.exit(1);
  }

  // Step 1: Get trader's positions
  console.log("1️⃣  Fetching trader positions...");
  const positions = await api.getPositions(traderAddress);

  if (positions.length === 0) {
    console.log("   No positions found. Try a different trader.");
    process.exit(0);
  }

  console.log(`   Found ${positions.length} positions\n`);

  // Step 2: Test price fetching
  console.log("2️⃣  Testing price fetch:\n");

  const testPositions = positions.slice(0, 3);

  for (const pos of testPositions) {
    const title = pos.marketTitle || pos.tokenId.slice(0, 30) + "...";
    console.log(`   📊 ${title}`);
    console.log(`      Token: ${pos.tokenId.slice(0, 40)}...`);
    console.log(
      `      curPrice (from positions): $${(pos.curPrice || 0).toFixed(4)}`,
    );
    console.log(`      avgPrice (trader's cost):  $${pos.avgPrice.toFixed(4)}`);

    try {
      // Using corrected getPrice - this now maps correctly!
      const buyPrice = await api.getPrice(pos.tokenId, "BUY"); // Gets ASK (via side=SELL)
      const sellPrice = await api.getPrice(pos.tokenId, "SELL"); // Gets BID (via side=BUY)

      const buyValid = buyPrice > 0 && buyPrice < 1;
      const sellValid = sellPrice > 0 && sellPrice < 1;

      console.log(
        `      Price to BUY at:  $${buyPrice.toFixed(4)} ${buyValid ? "✅" : "⚠️ (no liquidity)"}`,
      );
      console.log(
        `      Price to SELL at: $${sellPrice.toFixed(4)} ${sellValid ? "✅" : "⚠️ (no liquidity)"}`,
      );

      // Spread (should be positive: ASK > BID)
      if (buyValid && sellValid) {
        const spread = buyPrice - sellPrice;
        const spreadPercent = (spread / sellPrice) * 100;

        if (spread >= 0) {
          console.log(
            `      Spread:           $${spread.toFixed(4)} (${spreadPercent.toFixed(2)}%) ✅`,
          );
        } else {
          console.log(
            `      Spread:           $${spread.toFixed(4)} ⚠️ Negative (market anomaly)`,
          );
        }
      }
    } catch (error) {
      console.log(`      ❌ Error: ${error}`);
    }

    console.log("");
  }

  // Step 3: Test raw API calls to verify our mapping
  console.log("3️⃣  Verifying API mapping (first token):\n");
  const firstToken = testPositions[0].tokenId;

  try {
    // Raw API calls (no mapping)
    const rawBuy = await api.getRawPrice(firstToken, "BUY"); // Direct: side=BUY → BID
    const rawSell = await api.getRawPrice(firstToken, "SELL"); // Direct: side=SELL → ASK

    console.log(`   Raw API Results:`);
    console.log(`     /price?side=BUY (BID):  $${rawBuy.toFixed(4)}`);
    console.log(`     /price?side=SELL (ASK): $${rawSell.toFixed(4)}`);
    console.log("");

    // Our mapped calls
    const mappedBuy = await api.getPrice(firstToken, "BUY"); // Mapped: BUY intent → ASK
    const mappedSell = await api.getPrice(firstToken, "SELL"); // Mapped: SELL intent → BID

    console.log(`   Our Mapped Results:`);
    console.log(
      `     getPrice('BUY') → ASK:  $${mappedBuy.toFixed(4)} (should match raw SELL)`,
    );
    console.log(
      `     getPrice('SELL') → BID: $${mappedSell.toFixed(4)} (should match raw BUY)`,
    );

    // Verify mapping is correct
    if (
      Math.abs(mappedBuy - rawSell) < 0.0001 &&
      Math.abs(mappedSell - rawBuy) < 0.0001
    ) {
      console.log("\n   ✅ Mapping verified correct!");
    } else {
      console.log("\n   ⚠️ Mapping mismatch - check logic");
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error}`);
  }

  console.log("\n✅ Test complete!");
}

main().catch(console.error);
