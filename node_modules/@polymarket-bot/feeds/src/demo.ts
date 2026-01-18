/**
 * Demo: Connect to Polymarket WebSocket
 *
 * Run this with: npm run demo
 *
 * This will:
 * 1. Connect to Polymarket's WebSocket
 * 2. Subscribe to some popular markets
 * 3. Print any messages we receive
 *
 * Press Ctrl+C to stop
 */

import { PolymarketWebSocket } from "./websocket/PolymarketWebSocket";

// Some example token IDs from active Polymarket markets
// You can find these on Polymarket's website or via their API
// These are just examples - the actual IDs may have changed
const EXAMPLE_MARKETS: string[] = [
  // You can add specific token IDs here if you have them
  // For now, we'll just connect and see what we receive
];

async function main() {
  console.log("===========================================");
  console.log("  Polymarket WebSocket Demo");
  console.log("===========================================");
  console.log("");

  // Create WebSocket connection
  const ws = new PolymarketWebSocket({
    autoReconnect: true,
    maxReconnectAttempts: 5,
  });

  // Track message count
  let messageCount = 0;

  // Handle connection
  ws.on("connected", () => {
    console.log("✅ Connected to Polymarket!");
    console.log("");
    console.log("Waiting for messages...");
    console.log("(Press Ctrl+C to stop)");
    console.log("");
    console.log("-------------------------------------------");
  });

  // Handle messages
  ws.on("message", (msg) => {
    messageCount++;
    const data = msg.data as Record<string, unknown>;

    // Pretty print the message
    console.log(`\n📨 Message #${messageCount} at ${new Date().toISOString()}`);
    console.log("Type:", data.event_type || data.type || "unknown");

    // Print a summary based on message type
    if (data.event_type === "price_change") {
      console.log("  Market:", data.asset_id);
      console.log("  Price:", data.price);
    } else if (data.event_type === "trade") {
      console.log("  Maker:", data.maker);
      console.log("  Side:", data.side);
      console.log("  Price:", data.price);
      console.log("  Size:", data.size);
    } else {
      // For other message types, print the full data
      console.log("  Data:", JSON.stringify(data, null, 2));
    }
  });

  // Handle disconnection
  ws.on("disconnected", ({ code, reason }) => {
    console.log(`\n❌ Disconnected (code: ${code})`);
    if (reason) console.log("  Reason:", reason);
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error("\n⚠️ Error:", error.message);
  });

  // Connect
  try {
    await ws.connect();

    // If we have specific markets to subscribe to, do it
    if (EXAMPLE_MARKETS.length > 0) {
      console.log(`\nSubscribing to ${EXAMPLE_MARKETS.length} markets...`);
      ws.subscribeToMarkets(EXAMPLE_MARKETS);
    } else {
      console.log("\nNo specific markets configured.");
      console.log("The WebSocket will receive broadcast messages.");
      console.log("");
      console.log("💡 Tip: To subscribe to specific markets, add token IDs");
      console.log("   to the EXAMPLE_MARKETS array in this file.");
    }
  } catch (error) {
    console.error("Failed to connect:", error);
    process.exit(1);
  }

  // Handle Ctrl+C gracefully
  process.on("SIGINT", () => {
    console.log("\n\nShutting down...");
    console.log(`Total messages received: ${messageCount}`);
    ws.disconnect();
    process.exit(0);
  });

  // Keep the process running
  // The WebSocket will keep receiving messages
}

// Run the demo
main().catch(console.error);
