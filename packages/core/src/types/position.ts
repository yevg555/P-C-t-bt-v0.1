/**
 * Position Types
 * 
 * Positions represent the user's current holdings.
 * We track these to calculate P&L and enforce risk limits.
 */

/**
 * A single position (holdings in one token/market)
 */
export interface Position {
  /** Our internal ID */
  id: string;
  
  /** User who owns this position */
  userId: string;
  
  /** The token ID (market outcome) */
  tokenId: string;
  
  /** Number of shares held (can be negative for shorts) */
  quantity: number;
  
  /** Average price paid per share */
  averageEntryPrice: number;
  
  /** Current market price (from WebSocket) */
  currentMarketPrice: number;
  
  /** Unrealized profit/loss: (current - entry) * quantity */
  unrealizedPnl: number;
  
  /** When this position was last updated */
  lastUpdated: Date;
}

/**
 * Summary of all positions for a user
 */
export interface PositionSummary {
  /** All current positions */
  positions: Position[];
  
  /** Total value of all positions at current prices */
  totalValue: number;
  
  /** Total unrealized P&L across all positions */
  totalUnrealizedPnl: number;
  
  /** Available balance (USDC not in positions) */
  availableBalance: number;
  
  /** Total portfolio value (positions + available balance) */
  portfolioValue: number;
}

/**
 * A fill event - when an order gets executed
 */
export interface Fill {
  /** Our internal ID */
  id: string;
  
  /** User who owns this fill */
  userId: string;
  
  /** Order that was filled */
  orderId: string;
  
  /** Polymarket's fill ID */
  polymarketFillId?: string;
  
  /** How many shares were filled */
  filledQty: number;
  
  /** Price at which they were filled */
  filledPrice: number;
  
  /** Trading fee paid */
  fee: number;
  
  /** When the fill occurred */
  createdAt: Date;
}
