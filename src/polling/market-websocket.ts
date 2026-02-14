/**
 * MARKET WEBSOCKET CLIENT
 * ========================
 * Connects to Polymarket's CLOB WebSocket to receive real-time trade notifications.
 *
 * Used as a "trigger" layer in the hybrid architecture:
 * - WebSocket detects a trade event nearly instantly (~50-200ms)
 * - On detection, triggers an immediate poll of the /activity endpoint
 * - The poll confirms the trade and provides full trade details
 * - Regular polling continues as a fallback if WebSocket disconnects
 *
 * This eliminates the average polling interval wait (100ms with 200ms interval)
 * and makes trade detection nearly instant.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'eventemitter3';

export interface MarketWebSocketEvents {
  /** A trade was observed on the market — trigger an immediate poll */
  trade_signal: (tokenId: string) => void;
  /** WebSocket connected */
  connected: () => void;
  /** WebSocket disconnected */
  disconnected: (reason: string) => void;
  /** WebSocket error */
  error: (error: Error) => void;
}

interface LastTradeMessage {
  event_type: 'last_trade_price';
  asset_id: string;
  price: string;
  side: string;
  size: string;
  timestamp: string;
}

export class MarketWebSocket extends EventEmitter<MarketWebSocketEvents> {
  private static readonly WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

  private ws: WebSocket | null = null;
  private watchedTokenIds: Set<string> = new Set();
  private isRunning = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  /**
   * Start the WebSocket connection and subscribe to the given token IDs.
   * No authentication required for market channel.
   */
  start(tokenIds: string[]): void {
    if (this.isRunning) {
      return;
    }

    this.watchedTokenIds = new Set(tokenIds);
    if (this.watchedTokenIds.size === 0) {
      console.log('[MarketWS] No tokens to watch, skipping WebSocket');
      return;
    }

    this.isRunning = true;
    this.connect();
  }

  /**
   * Update the set of watched tokens (reconnects if needed)
   */
  updateTokens(tokenIds: string[]): void {
    const newSet = new Set(tokenIds);
    const hasChanges = tokenIds.some(id => !this.watchedTokenIds.has(id));

    if (hasChanges && this.ws?.readyState === WebSocket.OPEN) {
      // Send subscribe message for new tokens only
      const newTokens = tokenIds.filter(id => !this.watchedTokenIds.has(id));
      if (newTokens.length > 0) {
        this.watchedTokenIds = newSet;
        // Polymarket doesn't support incremental subscribe well,
        // so reconnect with updated token list
        this.reconnect();
      }
    } else {
      this.watchedTokenIds = newSet;
    }
  }

  /**
   * Stop the WebSocket connection
   */
  stop(): void {
    this.isRunning = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(MarketWebSocket.WS_URL);

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        console.log(`[MarketWS] Connected, subscribing to ${this.watchedTokenIds.size} tokens`);

        // Subscribe to market data for watched tokens
        const subscribeMsg = JSON.stringify({
          assets_ids: Array.from(this.watchedTokenIds),
          type: 'market',
        });
        this.ws!.send(subscribeMsg);

        // Heartbeat to keep connection alive
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 30000);

        this.emit('connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        const reasonStr = reason.toString() || `code ${code}`;
        this.emit('disconnected', reasonStr);

        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }

        if (this.isRunning) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (error: Error) => {
        this.emit('error', error);
      });

    } catch (error) {
      this.emit('error', error as Error);
      if (this.isRunning) {
        this.scheduleReconnect();
      }
    }
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const messages: unknown[] = JSON.parse(data.toString());

      // Polymarket sends arrays of messages
      const msgArray = Array.isArray(messages) ? messages : [messages];

      for (const msg of msgArray) {
        const typed = msg as { event_type?: string; asset_id?: string };
        if (typed.event_type === 'last_trade_price' && typed.asset_id) {
          // A trade happened on one of our watched markets!
          // This is the trigger signal — we don't use the WS data directly,
          // we just use it to know "poll NOW" instead of waiting for next interval
          if (this.watchedTokenIds.has(typed.asset_id)) {
            this.emit('trade_signal', typed.asset_id);
          }
        }
      }
    } catch {
      // Silently ignore malformed messages
    }
  }

  private reconnect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.connect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`[MarketWS] Max reconnect attempts (${this.maxReconnectAttempts}) reached. WebSocket disabled, polling-only mode.`);
      this.isRunning = false;
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    console.log(`[MarketWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
