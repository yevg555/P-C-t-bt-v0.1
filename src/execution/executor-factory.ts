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
  const privateKey = process.env.MY_PRIVATE_KEY || "";
  const funderAddress = process.env.FUNDER_ADDRESS || "";
  const signatureType = parseInt(process.env.SIGNATURE_TYPE || "2"); // Default: POLY_GNOSIS_SAFE

  // Safety checks
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

  if (!funderAddress || funderAddress === "0x0000000000000000000000000000000000000000") {
    console.error("");
    console.error("╔═════════════════════════════════════════════════════╗");
    console.error("║  ERROR: LIVE TRADING REQUIRES FUNDER ADDRESS        ║");
    console.error("╠═════════════════════════════════════════════════════╣");
    console.error("║  Set FUNDER_ADDRESS in your .env file               ║");
    console.error("║  This is your Polymarket proxy wallet address       ║");
    console.error("║  Find it at: polymarket.com/settings                ║");
    console.error("║                                                     ║");
    console.error("║  Or use TRADING_MODE=paper for testing              ║");
    console.error("╚═════════════════════════════════════════════════════╝");
    console.error("");
    throw new Error("Live trading requires funder address");
  }

  console.log("");
  console.log("╔═════════════════════════════════════════════════════╗");
  console.log("║  *** LIVE TRADING MODE ***                          ║");
  console.log("║  REAL MONEY WILL BE USED                            ║");
  console.log("╠═════════════════════════════════════════════════════╣");
  console.log(`║  Funder:  ${funderAddress.slice(0, 10)}...${funderAddress.slice(-8).padEnd(28)}║`);
  console.log(`║  SigType: ${signatureType === 0 ? "EOA" : signatureType === 1 ? "POLY_PROXY" : "POLY_GNOSIS_SAFE".padEnd(38)}║`);
  console.log("╚═════════════════════════════════════════════════════╝");
  console.log("");

  const config: LiveExecutorConfig = {
    privateKey,
    funderAddress,
    signatureType,
    clobApiUrl: process.env.CLOB_API_URL || undefined,
    chainId: process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID) : undefined,
    apiKey: process.env.CLOB_API_KEY || undefined,
    apiSecret: process.env.CLOB_SECRET || undefined,
    apiPassphrase: process.env.CLOB_PASSPHRASE || undefined,
    orderFillTimeoutSeconds: parseInt(process.env.ORDER_FILL_TIMEOUT_SECONDS || "30"),
    orderStatusPollIntervalMs: parseInt(process.env.ORDER_STATUS_POLL_INTERVAL_MS || "1000"),
    maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS || "200"),
    maxRetries: parseInt(process.env.MAX_API_RETRIES || "3"),
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
