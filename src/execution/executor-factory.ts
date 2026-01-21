/**
 * EXECUTOR FACTORY
 * ================
 * Creates the appropriate order executor based on configuration.
 *
 * Usage:
 *   const executor = createExecutor(); // reads from .env
 *   const executor = createExecutor({ mode: 'paper', paperBalance: 5000 });
 */

import { TradingMode, OrderExecutor, ExecutorConfig } from "../types";
import { PaperTradingExecutor, PaperExecutorConfig } from "./paper-executor";
import { LiveTradingExecutor, LiveExecutorConfig } from "./live-executor";

/**
 * Default configuration
 */
const DEFAULT_PAPER_BALANCE = 1000;

/**
 * Create an executor based on environment configuration
 */
export function createExecutor(overrides?: Partial<ExecutorConfig>): OrderExecutor {
  // Read mode from environment or use override
  const modeFromEnv = process.env.TRADING_MODE?.toLowerCase();
  const mode: TradingMode = overrides?.mode ?? (modeFromEnv === "live" ? "live" : "paper");

  // Validate mode
  if (mode !== "paper" && mode !== "live") {
    console.warn(`[EXECUTOR] Invalid TRADING_MODE '${mode}', defaulting to 'paper'`);
  }

  if (mode === "live") {
    return createLiveExecutor();
  } else {
    return createPaperExecutor(overrides?.paperBalance);
  }
}

/**
 * Create a paper trading executor
 */
export function createPaperExecutor(initialBalance?: number): PaperTradingExecutor {
  const balance =
    initialBalance ??
    parseFloat(process.env.PAPER_TRADING_BALANCE || String(DEFAULT_PAPER_BALANCE));

  const config: PaperExecutorConfig = {
    initialBalance: balance,
    slippageBps: 0, // Perfect fills for now
    fillRate: 1.0, // Always full fill
  };

  console.log("");
  console.log("┌─────────────────────────────────────────────────────┐");
  console.log("│  PAPER TRADING MODE                                 │");
  console.log("│  No real money will be used                         │");
  console.log(`│  Starting balance: $${balance.toFixed(2).padEnd(32)}│`);
  console.log("└─────────────────────────────────────────────────────┘");
  console.log("");

  return new PaperTradingExecutor(config);
}

/**
 * Create a live trading executor
 */
export function createLiveExecutor(): LiveTradingExecutor {
  const walletAddress = process.env.MY_WALLET_ADDRESS || "";
  const privateKey = process.env.MY_PRIVATE_KEY || "";

  // Safety check
  if (!walletAddress || walletAddress === "0x0000000000000000000000000000000000000000") {
    console.error("");
    console.error("╔═════════════════════════════════════════════════════╗");
    console.error("║  ERROR: LIVE TRADING REQUIRES WALLET CONFIGURATION  ║");
    console.error("╠═════════════════════════════════════════════════════╣");
    console.error("║  Set MY_WALLET_ADDRESS in your .env file            ║");
    console.error("║  Set MY_PRIVATE_KEY in your .env file               ║");
    console.error("║                                                     ║");
    console.error("║  Or use TRADING_MODE=paper for testing              ║");
    console.error("╚═════════════════════════════════════════════════════╝");
    console.error("");
    throw new Error("Live trading requires wallet configuration");
  }

  if (!privateKey) {
    console.error("");
    console.error("╔═════════════════════════════════════════════════════╗");
    console.error("║  ERROR: LIVE TRADING REQUIRES PRIVATE KEY           ║");
    console.error("╠═════════════════════════════════════════════════════╣");
    console.error("║  Set MY_PRIVATE_KEY in your .env file               ║");
    console.error("║  NEVER share this key with anyone!                  ║");
    console.error("║                                                     ║");
    console.error("║  Or use TRADING_MODE=paper for testing              ║");
    console.error("╚═════════════════════════════════════════════════════╝");
    console.error("");
    throw new Error("Live trading requires private key");
  }

  console.log("");
  console.log("╔═════════════════════════════════════════════════════╗");
  console.log("║  ⚠️  LIVE TRADING MODE                               ║");
  console.log("║  REAL MONEY WILL BE USED                            ║");
  console.log("╠═════════════════════════════════════════════════════╣");
  console.log(`║  Wallet: ${walletAddress.slice(0, 10)}...${walletAddress.slice(-8).padEnd(30)}║`);
  console.log("╚═════════════════════════════════════════════════════╝");
  console.log("");

  const config: LiveExecutorConfig = {
    walletAddress,
    privateKey,
  };

  return new LiveTradingExecutor(config);
}

/**
 * Get trading mode from environment
 */
export function getTradingMode(): TradingMode {
  const mode = process.env.TRADING_MODE?.toLowerCase();
  return mode === "live" ? "live" : "paper";
}

/**
 * Check if running in paper trading mode
 */
export function isPaperTrading(): boolean {
  return getTradingMode() === "paper";
}

/**
 * Check if running in live trading mode
 */
export function isLiveTrading(): boolean {
  return getTradingMode() === "live";
}
