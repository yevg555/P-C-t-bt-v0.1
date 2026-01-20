/**
 * DEBUG: Raw API Responses
 * ========================
 * Prints exactly what each API returns - no transformation
 *
 * Run with: npx ts-node scripts/debug-api.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

const DATA_API = "https://data-api.polymarket.com";
const CLOB_API = "https://clob.polymarket.com";

// Type for order book response
interface OrderBookResponse {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
}

async function main() {
  const traderAddress = process.env.TRADER_ADDRESS;

  if (!traderAddress || traderAddress.startsWith("0x00000")) {
    console.error("❌ Set TRADER_ADDRESS in .env first");
    process.exit(1);
  }

  console.log("═".repeat(70));
  console.log("DEBUG: RAW API RESPONSES");
  console.log("═".repeat(70));
  console.log(`Trader: ${traderAddress}`);
  console.log("");

  // ============================================
  // 1. DATA API - Positions
  // ============================================
  console.log("─".repeat(70));
  console.log("1️⃣  DATA API: GET /positions");
  console.log(
    `    URL: ${DATA_API}/positions?user=${traderAddress.slice(0, 20)}...`,
  );
  console.log("─".repeat(70));

  let testTokenId: string | null = null;

  try {
    const positionsUrl = `${DATA_API}/positions?user=${traderAddress}`;
    const positionsRes = await fetch(positionsUrl);

    console.log(
      `    Status: ${positionsRes.status} ${positionsRes.statusText}`,
    );
    console.log(`    Headers:`);
    console.log(
      `      Content-Type: ${positionsRes.headers.get("content-type")}`,
    );

    const positionsData = (await positionsRes.json()) as unknown[];

    console.log(`\n    Response (first 2 items if array):`);
    console.log("    " + "─".repeat(50));

    if (Array.isArray(positionsData)) {
      console.log(`    Array with ${positionsData.length} items`);
      positionsData.slice(0, 2).forEach((item: unknown, i: number) => {
        console.log(`\n    [${i}]:`);
        console.log(
          JSON.stringify(item, null, 2)
            .split("\n")
            .map((line) => "      " + line)
            .join("\n"),
        );
      });
      if (positionsData.length > 2) {
        console.log(`\n    ... and ${positionsData.length - 2} more items`);
      }

      // Get a token ID for further tests
      if (positionsData.length > 0) {
        const firstItem = positionsData[0] as Record<string, unknown>;
        testTokenId = (firstItem.asset ||
          firstItem.token_id ||
          firstItem.tokenId) as string | null;
      }
    } else {
      console.log(
        JSON.stringify(positionsData, null, 2)
          .split("\n")
          .map((line) => "      " + line)
          .join("\n"),
      );
    }
  } catch (error) {
    console.log(`    Error: ${error}`);
  }

  console.log("\n");

  if (testTokenId) {
    // ============================================
    // 2. CLOB API - Midpoint
    // ============================================
    console.log("─".repeat(70));
    console.log("2️⃣  CLOB API: GET /midpoint");
    console.log(
      `    URL: ${CLOB_API}/midpoint?token_id=${testTokenId.slice(0, 30)}...`,
    );
    console.log("─".repeat(70));

    try {
      const midpointUrl = `${CLOB_API}/midpoint?token_id=${testTokenId}`;
      const midpointRes = await fetch(midpointUrl);

      console.log(
        `    Status: ${midpointRes.status} ${midpointRes.statusText}`,
      );

      const midpointText = await midpointRes.text();
      console.log(`\n    Response (raw):`);
      console.log(`      ${midpointText}`);

      try {
        const midpointData = JSON.parse(midpointText);
        console.log(`\n    Response (parsed):`);
        console.log(
          JSON.stringify(midpointData, null, 2)
            .split("\n")
            .map((line) => "      " + line)
            .join("\n"),
        );
      } catch {
        console.log(`    (Not valid JSON)`);
      }
    } catch (error) {
      console.log(`    Error: ${error}`);
    }

    console.log("\n");

    // ============================================
    // 3. CLOB API - Price (BUY side)
    // ============================================
    console.log("─".repeat(70));
    console.log("3️⃣  CLOB API: GET /price (BUY side)");
    console.log(
      `    URL: ${CLOB_API}/price?token_id=${testTokenId.slice(0, 30)}...&side=BUY`,
    );
    console.log("─".repeat(70));

    try {
      const priceUrl = `${CLOB_API}/price?token_id=${testTokenId}&side=BUY`;
      const priceRes = await fetch(priceUrl);

      console.log(`    Status: ${priceRes.status} ${priceRes.statusText}`);

      const priceText = await priceRes.text();
      console.log(`\n    Response (raw):`);
      console.log(`      ${priceText}`);

      try {
        const priceData = JSON.parse(priceText);
        console.log(`\n    Response (parsed):`);
        console.log(
          JSON.stringify(priceData, null, 2)
            .split("\n")
            .map((line) => "      " + line)
            .join("\n"),
        );
      } catch {
        console.log(`    (Not valid JSON)`);
      }
    } catch (error) {
      console.log(`    Error: ${error}`);
    }

    console.log("\n");

    // ============================================
    // 4. CLOB API - Price (SELL side)
    // ============================================
    console.log("─".repeat(70));
    console.log("4️⃣  CLOB API: GET /price (SELL side)");
    console.log(
      `    URL: ${CLOB_API}/price?token_id=${testTokenId.slice(0, 30)}...&side=SELL`,
    );
    console.log("─".repeat(70));

    try {
      const priceUrl = `${CLOB_API}/price?token_id=${testTokenId}&side=SELL`;
      const priceRes = await fetch(priceUrl);

      console.log(`    Status: ${priceRes.status} ${priceRes.statusText}`);

      const priceText = await priceRes.text();
      console.log(`\n    Response (raw):`);
      console.log(`      ${priceText}`);

      try {
        const priceData = JSON.parse(priceText);
        console.log(`\n    Response (parsed):`);
        console.log(
          JSON.stringify(priceData, null, 2)
            .split("\n")
            .map((line) => "      " + line)
            .join("\n"),
        );
      } catch {
        console.log(`    (Not valid JSON)`);
      }
    } catch (error) {
      console.log(`    Error: ${error}`);
    }

    console.log("\n");

    // ============================================
    // 5. CLOB API - Order Book
    // ============================================
    console.log("─".repeat(70));
    console.log("5️⃣  CLOB API: GET /book");
    console.log(
      `    URL: ${CLOB_API}/book?token_id=${testTokenId.slice(0, 30)}...`,
    );
    console.log("─".repeat(70));

    try {
      const bookUrl = `${CLOB_API}/book?token_id=${testTokenId}`;
      const bookRes = await fetch(bookUrl);

      console.log(`    Status: ${bookRes.status} ${bookRes.statusText}`);

      const bookData = (await bookRes.json()) as OrderBookResponse;
      console.log(`\n    Response (summary):`);

      if (bookData.bids) {
        console.log(`      Bids: ${bookData.bids.length} orders`);
        if (bookData.bids.length > 0) {
          console.log(`      Best bid: ${JSON.stringify(bookData.bids[0])}`);
        }
      } else {
        console.log(`      Bids: none`);
      }

      if (bookData.asks) {
        console.log(`      Asks: ${bookData.asks.length} orders`);
        if (bookData.asks.length > 0) {
          console.log(`      Best ask: ${JSON.stringify(bookData.asks[0])}`);
        }
      } else {
        console.log(`      Asks: none`);
      }

      // Calculate midpoint manually
      if (
        bookData.bids &&
        bookData.bids.length > 0 &&
        bookData.asks &&
        bookData.asks.length > 0
      ) {
        const bestBid = parseFloat(bookData.bids[0].price);
        const bestAsk = parseFloat(bookData.asks[0].price);
        const midpoint = (bestBid + bestAsk) / 2;
        console.log(`\n      Calculated midpoint: $${midpoint.toFixed(4)}`);
      }
    } catch (error) {
      console.log(`    Error: ${error}`);
    }

    console.log("\n");

    // ============================================
    // 6. CLOB API - Spread
    // ============================================
    console.log("─".repeat(70));
    console.log("6️⃣  CLOB API: GET /spread");
    console.log(
      `    URL: ${CLOB_API}/spread?token_id=${testTokenId.slice(0, 30)}...`,
    );
    console.log("─".repeat(70));

    try {
      const spreadUrl = `${CLOB_API}/spread?token_id=${testTokenId}`;
      const spreadRes = await fetch(spreadUrl);

      console.log(`    Status: ${spreadRes.status} ${spreadRes.statusText}`);

      const spreadText = await spreadRes.text();
      console.log(`\n    Response (raw):`);
      console.log(`      ${spreadText}`);

      try {
        const spreadData = JSON.parse(spreadText);
        console.log(`\n    Response (parsed):`);
        console.log(
          JSON.stringify(spreadData, null, 2)
            .split("\n")
            .map((line) => "      " + line)
            .join("\n"),
        );
      } catch {
        console.log(`    (Not valid JSON)`);
      }
    } catch (error) {
      console.log(`    Error: ${error}`);
    }
  } else {
    console.log(
      "⚠️  No token ID found in positions - cannot test CLOB endpoints",
    );
  }

  console.log("\n");
  console.log("═".repeat(70));
  console.log("DEBUG COMPLETE");
  console.log("═".repeat(70));
}

main().catch(console.error);
