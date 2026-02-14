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

/**
 * Action to take when calculated trade amount is below minimum
 */
export type BelowMinLimitAction = "buy_at_min" | "skip";

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
  /** Action when calculated trade is below minimum: buy_at_min or skip */
  belowMinLimitAction?: BelowMinLimitAction;
}

export interface RiskConfig {
  maxDailyLoss: number;
  maxTotalLoss: number;
  /** Maximum amount to spend per token (not market) */
  maxTokenSpend?: number;
  /** Maximum amount to spend per market (includes all tokens in market) */
  maxMarketSpend?: number;
  /** Stop buying when total holdings value exceeds this */
  totalHoldingsLimit?: number;
}

/**
 * Auto TP/SL configuration
 */
export interface AutoTpSlConfig {
  /** Enable auto TP/SL feature */
  enabled: boolean;
  /** Take profit percentage from entry price (e.g., 0.10 = 10%) */
  takeProfitPercent?: number;
  /** Stop loss percentage from entry price (e.g., 0.05 = 5%) */
  stopLossPercent?: number;
}

/**
 * Wallet/Trader configuration with tagging
 */
export interface TraderConfig {
  /** Wallet address to copy */
  address: string;
  /** Friendly name/tag for the trader */
  tag?: string;
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
  /** Market ID this token belongs to */
  marketId?: string;
  /** Entry price for the initial position (for TP/SL calculation) */
  entryPrice?: number;
  /** Timestamp when position was opened */
  openedAt?: Date;
}

/**
 * Spend tracking for tokens and markets
 */
export interface SpendTracker {
  /** Total spent per token: tokenId -> USD amount */
  tokenSpend: Map<string, number>;
  /** Total spent per market: marketId -> USD amount */
  marketSpend: Map<string, number>;
  /** Total holdings value */
  totalHoldingsValue: number;
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

  /** Get all position details (for TP/SL monitoring) */
  getAllPositionDetails?(): Promise<Map<string, PaperPosition>>;

  /** Get spend tracker */
  getSpendTracker?(): SpendTracker;

  /** Sell all positions (1-Click Sell) */
  sellAllPositions?(currentPrices: Map<string, number>): Promise<OrderResult[]>;
}

// ============================================
// MARKET ANALYSIS TYPES
// ============================================

/**
 * A snapshot of market conditions at a point in time.
 * Built from the order book — gives us everything we need
 * to make an informed copy-trading decision.
 */
export interface MarketSnapshot {
  tokenId: string;
  timestamp: Date;

  /** Best ask price (what we'd pay to BUY) */
  bestAsk: number;
  /** Best bid price (what we'd get to SELL) */
  bestBid: number;
  /** Midpoint price */
  midpoint: number;

  /** Absolute spread (ask - bid) */
  spread: number;
  /** Spread as percentage of midpoint */
  spreadBps: number;

  /** Total shares available within 1% of best ask */
  askDepthNear: number;
  /** Total shares available within 1% of best bid */
  bidDepthNear: number;

  /** Weighted average price to fill `targetSize` shares (BUY side) */
  weightedAskForSize?: number;
  /** Weighted average price to fill `targetSize` shares (SELL side) */
  weightedBidForSize?: number;

  /** How much the price has moved since the trader's fill */
  divergenceFromTrader: number;
  /** Divergence as basis points */
  divergenceBps: number;

  /** Is the book too thin / spread too wide? */
  isVolatile: boolean;
  /** Human-readable market condition */
  condition: "normal" | "wide_spread" | "thin_book" | "high_divergence" | "stale";
  /** Reasons for the condition assessment */
  conditionReasons: string[];
}

/**
 * Configuration for market analysis thresholds
 */
export interface MarketAnalysisConfig {
  /** Spread above this (bps) is considered "wide" — triggers adaptive offset */
  wideSpreadThresholdBps: number;
  /** Spread above this (bps) rejects the trade entirely */
  maxSpreadBps: number;
  /** Divergence above this (bps) from trader's price rejects the trade */
  maxDivergenceBps: number;
  /** Minimum depth (shares) required near best price to proceed */
  minDepthShares: number;
  /** How far from best price to measure depth (as multiplier, e.g. 0.01 = 1%) */
  depthRangePercent: number;
  /** Price data older than this (ms) is considered stale */
  stalePriceThresholdMs: number;
}

/**
 * The final trade decision with full reasoning
 */
export interface TradeDecision {
  /** Should we execute this trade? */
  execute: boolean;
  /** Why we made this decision */
  reason: string;
  /** Detailed adjustments applied */
  adjustments: string[];

  /** Final order parameters (if execute=true) */
  finalPrice?: number;
  finalSize?: number;
  finalOffsetBps?: number;
  expirationMs?: number;

  /** Market snapshot used for the decision */
  marketSnapshot?: MarketSnapshot;
  /** Risk level based on market conditions */
  marketRisk: "low" | "medium" | "high" | "extreme";
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
