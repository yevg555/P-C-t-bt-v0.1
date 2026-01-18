"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolymarketWebSocket = void 0;
// WebSocket connection
var websocket_1 = require("./websocket");
Object.defineProperty(exports, "PolymarketWebSocket", { enumerable: true, get: function () { return websocket_1.PolymarketWebSocket; } });
//# sourceMappingURL=index.js.map