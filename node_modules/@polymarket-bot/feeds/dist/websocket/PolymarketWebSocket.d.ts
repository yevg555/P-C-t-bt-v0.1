/**
 * Polymarket WebSocket Connection
 *
 * This module connects to Polymarket's WebSocket feed and receives
 * real-time market data. It's the foundation for detecting trades.
 *
 * Polymarket WebSocket endpoint:
 * wss://ws-subscriptions-clob.polymarket.com/ws/market
 *
 * Documentation:
 * https://docs.polymarket.com/developers/market-makers/data-feeds
 */
import { EventEmitter } from 'events';
/**
 * Connection states for the WebSocket
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
/**
 * Raw message received from Polymarket WebSocket
 * We'll parse this into proper types later
 */
export interface RawWebSocketMessage {
    /** The raw JSON data received */
    data: unknown;
    /** When we received this message */
    receivedAt: number;
}
/**
 * Options for the WebSocket connection
 */
export interface WebSocketOptions {
    /** Auto-reconnect on disconnect? (default: true) */
    autoReconnect?: boolean;
    /** Max reconnection attempts (default: 10) */
    maxReconnectAttempts?: number;
    /** Initial reconnect delay in ms (default: 1000) */
    reconnectDelay?: number;
    /** Max reconnect delay in ms (default: 30000) */
    maxReconnectDelay?: number;
}
/**
 * PolymarketWebSocket
 *
 * Connects to Polymarket's WebSocket feed and emits events for:
 * - 'message': Raw message received
 * - 'connected': Connection established
 * - 'disconnected': Connection lost
 * - 'error': Error occurred
 *
 * @example
 * ```typescript
 * const ws = new PolymarketWebSocket();
 *
 * ws.on('message', (msg) => {
 *   console.log('Received:', msg.data);
 * });
 *
 * ws.on('connected', () => {
 *   console.log('Connected!');
 *   ws.subscribeToMarket('some-token-id');
 * });
 *
 * await ws.connect();
 * ```
 */
export declare class PolymarketWebSocket extends EventEmitter {
    private ws;
    private options;
    private state;
    private reconnectAttempts;
    private reconnectTimer;
    private subscribedAssets;
    constructor(options?: WebSocketOptions);
    /**
     * Get current connection state
     */
    getState(): ConnectionState;
    /**
     * Check if connected
     */
    isConnected(): boolean;
    /**
     * Connect to Polymarket WebSocket
     */
    connect(): Promise<void>;
    /**
     * Disconnect from WebSocket
     */
    disconnect(): void;
    /**
     * Subscribe to a market by asset ID (token ID)
     *
     * @param assetId - The token ID to subscribe to
     */
    subscribeToMarket(assetId: string): void;
    /**
     * Subscribe to multiple markets at once
     *
     * @param assetIds - Array of token IDs to subscribe to
     */
    subscribeToMarkets(assetIds: string[]): void;
    /**
     * Re-subscribe to all previously subscribed assets
     * Called after reconnection
     */
    private resubscribe;
    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    private scheduleReconnect;
}
//# sourceMappingURL=PolymarketWebSocket.d.ts.map