/**
 * Core Types Package
 *
 * This package contains all TypeScript type definitions for the
 * Polymarket copy-trading bot. Other packages import from here.
 *
 * Usage:
 *   import { TradeEvent, Order, CopyConfig } from '@polymarket-bot/core';
 */

// Trade types
export { TradeSide, OrderType, TradeEvent, DetectedTrade } from "./types/trade";

// Order types
export { OrderStatus, OrderSpec, Order, OrderResult } from "./types/order";

// Position types
export { Position, PositionSummary, Fill } from "./types/position";

// Configuration types
export {
  SizingMethod,
  MinSizePolicy,
  CopyConfig,
  TargetTrader,
  DEFAULT_COPY_CONFIG,
} from "./types/config";

// Event types
export {
  EventType,
  BaseEvent,
  TradeReceivedEvent,
  TradeDetectedEvent,
  OrderComputedEvent,
  OrderSubmittedEvent,
  OrderFilledEvent,
  OrderCancelledEvent,
  OrderFailedEvent,
  RiskBreachEvent,
  KillSwitchEvent,
  ErrorEvent,
  SystemEvent,
} from "./types/events";
