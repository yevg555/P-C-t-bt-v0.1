/**
 * Order Types
 * 
 * These types represent orders that OUR bot will place.
 * After detecting a trade from a target trader, we compute a copy order.
 */

import { TradeSide, OrderType } from './trade';

/**
 * Status of an order we've placed
 */
export type OrderStatus = 
  | 'pending'    // Order created, not yet submitted
  | 'submitted'  // Sent to Polymarket API
  | 'live'       // Resting on the orderbook
  | 'matched'    // Fully filled
  | 'partial'    // Partially filled
  | 'cancelled'  // Cancelled by user or system
  | 'expired'    // GTD order that expired
  | 'failed';    // Failed to submit (API error)

/**
 * Specification for an order we want to place
 * This is the OUTPUT of our strategy module
 */
export interface OrderSpec {
  /** The token ID (market outcome) to trade */
  tokenId: string;
  
  /** BUY or SELL */
  side: TradeSide;
  
  /** Price per share (0.01 to 0.99) */
  price: number;
  
  /** Number of shares to trade */
  size: number;
  
  /** Order type (GTC, GTD, FOK) */
  orderType: OrderType;
  
  /** For GTD orders: Unix timestamp when order expires */
  expiration?: number;
  
  /** If true, order will only rest on book (won't match immediately) */
  postOnly?: boolean;
}

/**
 * A complete order record (stored in database)
 * Includes both the spec and the result of placing it
 */
export interface Order {
  /** Our internal order ID (UUID) */
  id: string;
  
  /** User who owns this order */
  userId: string;
  
  /** Polymarket's order ID (received after submission) */
  polymarketOrderId?: string;
  
  /** Hash for idempotency (prevents duplicate orders) */
  orderHash: string;
  
  /** The target trader whose trade we're copying */
  targetTraderAddress: string;
  
  /** Order details */
  tokenId: string;
  side: TradeSide;
  price: number;
  size: number;
  orderType: OrderType;
  
  /** Current status */
  status: OrderStatus;
  
  /** How much has been filled so far */
  filledQty: number;
  
  /** Average fill price (if partially/fully filled) */
  filledPrice?: number;
  
  /** Error message if status is 'failed' */
  errorReason?: string;
  
  /** Timestamps */
  createdAt: Date;
  submittedAt?: Date;
  filledAt?: Date;
  cancelledAt?: Date;
}

/**
 * Result of submitting an order to Polymarket
 */
export interface OrderResult {
  /** Whether submission succeeded */
  success: boolean;
  
  /** Polymarket's order ID (if successful) */
  orderId?: string;
  
  /** Order hash for tracking */
  orderHash?: string;
  
  /** Initial status from Polymarket */
  status?: 'matched' | 'live' | 'delayed';
  
  /** Error message (if failed) */
  error?: string;
}
