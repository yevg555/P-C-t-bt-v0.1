/**
 * Feeds Package
 * 
 * This package handles all data streaming from Polymarket:
 * - WebSocket connections for real-time data
 * - Trade detection and filtering
 * - Message parsing and normalization
 * 
 * Usage:
 *   import { PolymarketWebSocket } from '@polymarket-bot/feeds';
 */

// WebSocket connection
export {
  PolymarketWebSocket,
  ConnectionState,
  RawWebSocketMessage,
  WebSocketOptions,
} from './websocket';
