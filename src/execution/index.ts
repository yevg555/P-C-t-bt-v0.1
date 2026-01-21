/**
 * EXECUTION MODULE
 * ================
 * Order execution for both paper and live trading.
 *
 * Usage:
 *   import { createExecutor, PaperTradingExecutor } from './execution';
 *
 *   // Create executor based on .env TRADING_MODE
 *   const executor = createExecutor();
 *
 *   // Execute an order
 *   const result = await executor.execute({
 *     tokenId: '0x...',
 *     side: 'BUY',
 *     size: 100,
 *     price: 0.65,
 *   });
 */

// Executors
export { PaperTradingExecutor, PaperExecutorConfig } from "./paper-executor";
export { LiveTradingExecutor, LiveExecutorConfig } from "./live-executor";

// Factory
export {
  createExecutor,
  createPaperExecutor,
  createLiveExecutor,
  getTradingMode,
  isPaperTrading,
  isLiveTrading,
} from "./executor-factory";
