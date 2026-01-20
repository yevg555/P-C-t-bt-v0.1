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
}

export interface RiskConfig {
  maxDailyLoss: number;
  maxTotalLoss: number;
}

// ============================================
// ORDER TYPES (Phase 3)
// ============================================

export interface OrderSpec {
  tokenId: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  triggeredBy?: PositionChange;
}

export interface OrderResult {
  orderId: string;
  status: "pending" | "live" | "filled" | "cancelled" | "failed";
  filledSize: number;
  error?: string;
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
