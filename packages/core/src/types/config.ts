/**
 * Configuration Types
 * 
 * These define how the copy-trading bot behaves.
 * Users can customize sizing, risk limits, and which traders to copy.
 */

/**
 * Method for calculating copy trade size
 * 
 * - proportional_to_portfolio: Copy at a % of YOUR balance
 *   Example: If you have $1000 and set 5%, you trade $50 worth
 * 
 * - proportional_to_trader: Copy a fraction of the TRADER's size
 *   Example: If trader buys 100 shares and you set 50%, you buy 50 shares
 */
export type SizingMethod = 
  | 'proportional_to_portfolio'
  | 'proportional_to_trader';

/**
 * What to do when calculated size is below minimum
 */
export type MinSizePolicy = 
  | 'skip'          // Don't place the order
  | 'place_minimum'; // Place order at minimum size anyway

/**
 * Copy trading configuration for a user
 */
export interface CopyConfig {
  /** How to calculate copy trade size */
  sizingMethod: SizingMethod;
  
  /**
   * For 'proportional_to_portfolio' method:
   * What percentage of your balance to trade
   * Example: 0.05 = 5%
   */
  portfolioPercentage?: number;
  
  /**
   * For 'proportional_to_trader' method:
   * What fraction of the trader's size to copy
   * Example: 0.5 = copy 50% of their trade size
   */
  traderFraction?: number;
  
  /**
   * Price adjustment in basis points
   * Positive = buy higher / sell lower (more aggressive)
   * Negative = buy lower / sell higher (try to get better price)
   * Example: 50 = +0.5% price adjustment
   */
  priceOffsetBps: number;
  
  /**
   * Maximum shares to buy per token
   * Prevents overexposure to a single market
   */
  maxPositionPerToken: number;
  
  /**
   * Maximum total shares across all positions
   * Overall portfolio size limit
   */
  maxTotalPosition: number;
  
  /**
   * Minimum order size (in shares)
   * Polymarket has minimums; also helps avoid tiny orders
   */
  minOrderSize: number;
  
  /**
   * What to do if calculated size is below minimum
   */
  minSizePolicy: MinSizePolicy;
  
  /**
   * Maximum loss allowed per day (in USDC)
   * Bot stops trading if daily loss exceeds this
   */
  maxDailyLoss: number;
  
  /**
   * Maximum total loss allowed (in USDC)
   * Kill-switch triggers if total loss exceeds this
   */
  maxTotalLoss: number;
}

/**
 * A target trader to copy
 */
export interface TargetTrader {
  /** Our internal ID */
  id: string;
  
  /** User who is copying this trader */
  userId: string;
  
  /** Ethereum address of the trader to copy */
  address: string;
  
  /** Friendly name/label (optional) */
  name?: string;
  
  /** Whether we're actively copying this trader */
  isActive: boolean;
  
  /** When we started copying this trader */
  createdAt: Date;
}

/**
 * Default configuration for new users
 * Conservative settings to start safely
 */
export const DEFAULT_COPY_CONFIG: CopyConfig = {
  sizingMethod: 'proportional_to_portfolio',
  portfolioPercentage: 0.05,  // 5% of portfolio per trade
  priceOffsetBps: 0,          // No price adjustment
  maxPositionPerToken: 1000,  // Max 1000 shares per token
  maxTotalPosition: 5000,     // Max 5000 shares total
  minOrderSize: 10,           // Minimum 10 shares
  minSizePolicy: 'skip',      // Skip tiny orders
  maxDailyLoss: 100,          // Stop if down $100/day
  maxTotalLoss: 500,          // Kill-switch at $500 total loss
};
