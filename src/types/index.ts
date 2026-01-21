/**
 * TYPE DEFINITIONS FOR COPY TRADING BOT
 * =====================================
 */

// ============================================
// POSITION TYPES
// ============================================

/**
 * A position that a trader holds on Polymarket
 */
export interface Position {
  /** Unique ID for this outcome token */
  tokenId: string;

  /** Market/condition this belongs to */
  marketId: string;

  /** Number of shares owned */
  quantity: number;

  /** Average price paid per share */
  avgPrice: number;

  /** Current market price (from API) */
  curPrice?: number;

  /** Human-readable market title */
  marketTitle?: string;

  /** Which outcome: "Yes", "No", "Up", "Down", etc */
  outcome?: string;
}

/**
 * A snapshot of all positions at a point in time
 */
export interface PositionSnapshot {
  traderAddress: string;
  positions: Position[];
  timestamp: Date;
}

// ============================================
// CHANGE DETECTION TYPES
// ============================================

/**
 * When we detect a change in a position
 */
export interface PositionChange {
  tokenId: string;
  marketId: string;
  side: "BUY" | "SELL";
  delta: number;
  previousQuantity: number;
  currentQuantity: number;
  detectedAt: Date;
  marketTitle?: string;

  /** Current market price at time of detection */
  curPrice?: number;
}

// ============================================
// CONFIGURATION TYPES
// ============================================

export interface PollerConfig {
  traderAddress: string;
  intervalMs: number;
  maxConsecutiveErrors: number;
}

export interface CopyConfig {
  sizingMethod:
    | "proportional_to_portfolio"
    | "proportional_to_trader"
    | "fixed";
  portfolioPercentage: number;
  priceOffsetBps: number;
  minOrderSize: number;
  maxPositionPerToken: number;
  maxTotalPosition: number;
  /** SELL strategy: how to size sells when copying exits */
  sellStrategy?: SellStrategy;
  /** Order type: limit (default) or market */
  orderType?: OrderType;
  /** Order expiration in seconds (0 = GTC) */
  orderExpirationSeconds?: number;
}

export interface RiskConfig {
  maxDailyLoss: number;
  maxTotalLoss: number;
}

// ============================================
// TRADING MODE TYPES
// ============================================

/**
 * Trading mode determines how orders are executed
 * - paper: Simulated trading for testing (no real money)
 * - live: Real trading with actual funds
 */
export type TradingMode = "paper" | "live";

/**
 * Configuration for the trading executor
 */
export interface ExecutorConfig {
  mode: TradingMode;
  /** Starting balance for paper trading */
  paperBalance?: number;
}

// ============================================
// ORDER TYPES (Phase 3)
// ============================================

/**
 * Order type determines how the order is executed
 */
export type OrderType = "limit" | "market";

/**
 * SELL strategy when copying a trader's exit
 */
export type SellStrategy = "proportional" | "full_exit" | "match_delta";

/**
 * Specification for an order to be executed
 */
export interface OrderSpec {
  tokenId: string;
  side: "BUY" | "SELL";
  size: number;
  /** Limit price (for limit orders) or max/min price (for market orders) */
  price: number;
  /** Order type: limit (default) or market */
  orderType?: OrderType;
  /** Expiration time in milliseconds from now (0 = GTC) */
  expiresInMs?: number;
  /** Absolute expiration timestamp */
  expiresAt?: Date;
  /** Price offset that was applied (in basis points) */
  priceOffsetBps?: number;
  /** The position change that triggered this order */
  triggeredBy?: PositionChange;
}

export interface OrderResult {
  orderId: string;
  status: "pending" | "live" | "filled" | "partial" | "expired" | "cancelled" | "failed";
  filledSize: number;
  /** Remaining unfilled size (for partial fills) */
  remainingSize?: number;
  avgFillPrice?: number;
  error?: string;
  /** Timestamp when the order was placed */
  placedAt?: Date;
  /** Timestamp when the order was executed/completed */
  executedAt: Date;
  /** Which mode executed this order */
  executionMode: TradingMode;
  /** Was this order a limit or market order */
  orderType?: OrderType;
  /** Did the order expire? */
  expired?: boolean;
}

/**
 * A paper trade record for tracking simulated trades
 */
export interface PaperTrade {
  orderId: string;
  tokenId: string;
  marketId?: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  cost: number;
  executedAt: Date;
}

/**
 * Paper trading portfolio state
 */
export interface PaperPortfolio {
  balance: number;
  initialBalance: number;
  positions: Map<string, PaperPosition>;
  trades: PaperTrade[];
  totalPnL: number;
}

/**
 * A paper position (simulated holding)
 */
export interface PaperPosition {
  tokenId: string;
  quantity: number;
  avgPrice: number;
  totalCost: number;
}

/**
 * Interface that all order executors must implement
 */
export interface OrderExecutor {
  /** Execute an order */
  execute(order: OrderSpec): Promise<OrderResult>;

  /** Get current balance */
  getBalance(): Promise<number>;

  /** Get position for a token (0 if none) */
  getPosition(tokenId: string): Promise<number>;

  /** Get all positions */
  getAllPositions(): Promise<Map<string, number>>;

  /** Get the trading mode */
  getMode(): TradingMode;

  /** Check if executor is ready to trade */
  isReady(): Promise<boolean>;
}

// ============================================
// API RESPONSE TYPES
// ============================================

/**
 * Raw position response from Polymarket API
 * Based on actual API response structure
 */
export interface RawPositionResponse {
  // Token identifiers
  asset?: string;
  token_id?: string;
  tokenId?: string;

  // Market identifiers (API uses conditionId, not condition_id)
  market?: string;
  condition_id?: string;
  conditionId?: string;

  // Quantities
  size?: string | number;
  quantity?: string | number;

  // Prices (API returns these as numbers, not strings)
  avgPrice?: number | string;
  avg_price?: string;
  curPrice?: number | string;

  // Titles
  title?: string;
  market_title?: string;

  // Outcome info
  outcome?: string;
  outcomeIndex?: number;
  oppositeOutcome?: string;
  oppositeAsset?: string;

  // Wallet info
  proxyWallet?: string;

  // Value tracking
  initialValue?: number;
  currentValue?: number;
  cashPnl?: number;
  percentPnl?: number;
  totalBought?: number;
  realizedPnl?: number;
  percentRealizedPnl?: number;

  // Status flags
  redeemable?: boolean;
  mergeable?: boolean;
  negativeRisk?: boolean;

  // Metadata
  slug?: string;
  icon?: string;
  eventId?: string;
  eventSlug?: string;
  endDate?: string;
}
