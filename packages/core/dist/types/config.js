"use strict";
/**
 * Configuration Types
 *
 * These define how the copy-trading bot behaves.
 * Users can customize sizing, risk limits, and which traders to copy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_COPY_CONFIG = void 0;
/**
 * Default configuration for new users
 * Conservative settings to start safely
 */
exports.DEFAULT_COPY_CONFIG = {
    sizingMethod: 'proportional_to_portfolio',
    portfolioPercentage: 0.05, // 5% of portfolio per trade
    priceOffsetBps: 0, // No price adjustment
    maxPositionPerToken: 1000, // Max 1000 shares per token
    maxTotalPosition: 5000, // Max 5000 shares total
    minOrderSize: 10, // Minimum 10 shares
    minSizePolicy: 'skip', // Skip tiny orders
    maxDailyLoss: 100, // Stop if down $100/day
    maxTotalLoss: 500, // Kill-switch at $500 total loss
};
//# sourceMappingURL=config.js.map