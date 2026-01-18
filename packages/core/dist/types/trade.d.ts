/**
 * Trade Types
 *
 * These types represent trades detected from Polymarket's WebSocket feed.
 * When a target trader places an order, we receive a TradeEvent.
 */
/**
 * The side of a trade - either buying or selling
 */
export type TradeSide = 'BUY' | 'SELL';
/**
 * Order types supported by Polymarket
 * - GTC: Good-Till-Cancelled (stays until filled or cancelled)
 * - GTD: Good-Till-Date (expires at a specific time)
 * - FOK: Fill-or-Kill (fills immediately or rejects)
 */
export type OrderType = 'GTC' | 'GTD' | 'FOK';
/**
 * A trade event detected from the Polymarket WebSocket
 * This is what we receive when someone places an order
 */
export interface TradeEvent {
    /** Unique identifier for this order from Polymarket */
    orderId: string;
    /** Ethereum address of the trader who placed the order */
    makerAddress: string;
    /** The token ID (market outcome) being traded */
    tokenId: string;
    /** Whether this is a BUY or SELL order */
    side: TradeSide;
    /** Price per share (0.01 to 0.99 for binary markets) */
    price: number;
    /** Number of shares being traded */
    size: number;
    /** Unix timestamp (milliseconds) when the trade occurred */
    timestamp: number;
    /** Type of order (GTC, GTD, or FOK) */
    orderType: OrderType;
}
/**
 * A filtered trade event - this is a TradeEvent that we've confirmed
 * came from one of our target traders
 */
export interface DetectedTrade extends TradeEvent {
    /** Which target trader this trade came from (for multi-trader support) */
    targetTraderId: string;
    /** When we detected this trade (our timestamp, not Polymarket's) */
    detectedAt: number;
}
//# sourceMappingURL=trade.d.ts.map