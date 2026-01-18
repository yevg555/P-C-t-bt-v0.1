/**
 * Core Types Package
 *
 * This package contains all TypeScript type definitions for the
 * Polymarket copy-trading bot. Other packages import from here.
 *
 * Usage:
 *   import { TradeEvent, Order, CopyConfig } from '@polymarket-bot/core';
 */
export { TradeSide, OrderType, TradeEvent, DetectedTrade } from "./types/trade";
export { OrderStatus, OrderSpec, Order, OrderResult } from "./types/order";
export { Position, PositionSummary, Fill } from "./types/position";
export { SizingMethod, MinSizePolicy, CopyConfig, TargetTrader, DEFAULT_COPY_CONFIG, } from "./types/config";
export { EventType, BaseEvent, TradeReceivedEvent, TradeDetectedEvent, OrderComputedEvent, OrderSubmittedEvent, OrderFilledEvent, OrderCancelledEvent, OrderFailedEvent, RiskBreachEvent, KillSwitchEvent, ErrorEvent, SystemEvent, } from "./types/events";
//# sourceMappingURL=index.d.ts.map