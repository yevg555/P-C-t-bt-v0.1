"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolymarketWebSocket = void 0;
const ws_1 = __importDefault(require("ws"));
const events_1 = require("events");
/**
 * Default options
 */
const DEFAULT_OPTIONS = {
    autoReconnect: true,
    maxReconnectAttempts: 10,
    reconnectDelay: 1000,
    maxReconnectDelay: 30000,
};
/**
 * Polymarket WebSocket endpoint
 */
const POLYMARKET_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
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
class PolymarketWebSocket extends events_1.EventEmitter {
    constructor(options = {}) {
        super();
        this.ws = null;
        this.state = 'disconnected';
        this.reconnectAttempts = 0;
        this.reconnectTimer = null;
        this.subscribedAssets = new Set();
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    /**
     * Get current connection state
     */
    getState() {
        return this.state;
    }
    /**
     * Check if connected
     */
    isConnected() {
        return this.state === 'connected' && this.ws?.readyState === ws_1.default.OPEN;
    }
    /**
     * Connect to Polymarket WebSocket
     */
    async connect() {
        if (this.state === 'connected' || this.state === 'connecting') {
            console.log('[WS] Already connected or connecting');
            return;
        }
        this.state = 'connecting';
        console.log('[WS] Connecting to Polymarket...');
        return new Promise((resolve, reject) => {
            try {
                this.ws = new ws_1.default(POLYMARKET_WS_URL);
                // Connection opened
                this.ws.on('open', () => {
                    console.log('[WS] Connected to Polymarket!');
                    this.state = 'connected';
                    this.reconnectAttempts = 0;
                    this.emit('connected');
                    // Re-subscribe to any assets we were tracking
                    this.resubscribe();
                    resolve();
                });
                // Message received
                this.ws.on('message', (data) => {
                    try {
                        const parsed = JSON.parse(data.toString());
                        const message = {
                            data: parsed,
                            receivedAt: Date.now(),
                        };
                        this.emit('message', message);
                    }
                    catch (error) {
                        console.error('[WS] Failed to parse message:', error);
                        this.emit('error', new Error('Failed to parse WebSocket message'));
                    }
                });
                // Connection closed
                this.ws.on('close', (code, reason) => {
                    console.log(`[WS] Disconnected (code: ${code}, reason: ${reason.toString()})`);
                    this.state = 'disconnected';
                    this.emit('disconnected', { code, reason: reason.toString() });
                    // Attempt reconnection if enabled
                    if (this.options.autoReconnect) {
                        this.scheduleReconnect();
                    }
                });
                // Error occurred
                this.ws.on('error', (error) => {
                    console.error('[WS] Error:', error.message);
                    this.emit('error', error);
                    // Reject only if we're still connecting
                    if (this.state === 'connecting') {
                        reject(error);
                    }
                });
            }
            catch (error) {
                this.state = 'disconnected';
                reject(error);
            }
        });
    }
    /**
     * Disconnect from WebSocket
     */
    disconnect() {
        console.log('[WS] Disconnecting...');
        // Clear any pending reconnect
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        // Close the WebSocket
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.state = 'disconnected';
        this.subscribedAssets.clear();
    }
    /**
     * Subscribe to a market by asset ID (token ID)
     *
     * @param assetId - The token ID to subscribe to
     */
    subscribeToMarket(assetId) {
        if (!this.isConnected()) {
            console.warn('[WS] Not connected, queuing subscription for:', assetId);
            this.subscribedAssets.add(assetId);
            return;
        }
        console.log('[WS] Subscribing to market:', assetId);
        this.subscribedAssets.add(assetId);
        const subscribeMessage = {
            type: 'market',
            assets_ids: [assetId],
        };
        this.ws.send(JSON.stringify(subscribeMessage));
    }
    /**
     * Subscribe to multiple markets at once
     *
     * @param assetIds - Array of token IDs to subscribe to
     */
    subscribeToMarkets(assetIds) {
        if (!this.isConnected()) {
            console.warn('[WS] Not connected, queuing subscriptions');
            assetIds.forEach(id => this.subscribedAssets.add(id));
            return;
        }
        console.log('[WS] Subscribing to', assetIds.length, 'markets');
        assetIds.forEach(id => this.subscribedAssets.add(id));
        // Polymarket allows up to 500 assets per subscription
        const batchSize = 500;
        for (let i = 0; i < assetIds.length; i += batchSize) {
            const batch = assetIds.slice(i, i + batchSize);
            const subscribeMessage = {
                type: 'market',
                assets_ids: batch,
            };
            this.ws.send(JSON.stringify(subscribeMessage));
        }
    }
    /**
     * Re-subscribe to all previously subscribed assets
     * Called after reconnection
     */
    resubscribe() {
        if (this.subscribedAssets.size > 0) {
            console.log('[WS] Re-subscribing to', this.subscribedAssets.size, 'markets');
            this.subscribeToMarkets(Array.from(this.subscribedAssets));
        }
    }
    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            console.error('[WS] Max reconnection attempts reached');
            this.emit('error', new Error('Max reconnection attempts reached'));
            return;
        }
        this.state = 'reconnecting';
        this.reconnectAttempts++;
        // Exponential backoff: 1s, 2s, 4s, 8s, ... up to maxReconnectDelay
        const delay = Math.min(this.options.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.options.maxReconnectDelay);
        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`);
        this.reconnectTimer = setTimeout(async () => {
            try {
                await this.connect();
            }
            catch (error) {
                console.error('[WS] Reconnection failed:', error);
                // Will trigger another reconnect attempt via the 'close' handler
            }
        }, delay);
    }
}
exports.PolymarketWebSocket = PolymarketWebSocket;
//# sourceMappingURL=PolymarketWebSocket.js.map