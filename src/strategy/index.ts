/**
 * STRATEGY MODULE
 * ===============
 * Exports all strategy-related classes
 */

export { CopySizeCalculator, DEFAULT_COPY_CONFIG, POLYMARKET_MIN_SHARES } from './copy-size';
export type { CopySizeInput, CopySizeResult } from './copy-size';

export { RiskChecker, DEFAULT_RISK_CONFIG } from './risk-checker';
export type { TradingState, RiskCheckResult } from './risk-checker';

export { PriceAdjuster, adjustPrice, calculateSlippageCost } from './price-adjuster';

export { TpSlMonitor, DEFAULT_TP_SL_CONFIG } from './tp-sl-monitor';
export type { TpSlTriggerEvent } from './tp-sl-monitor';
