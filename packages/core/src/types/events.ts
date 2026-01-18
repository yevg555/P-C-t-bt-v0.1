/**
 * Event Types
 * 
 * These represent events that flow through our system.
 * We use an event-driven architecture for loose coupling.
 */

import { TradeEvent, DetectedTrade } from './trade';
import { OrderSpec, OrderResult, OrderStatus } from './order';
import { Fill } from './position';

/**
 * All possible event types in our system
 */
export type EventType =
  | 'trade_received'      // Raw trade from WebSocket
  | 'trade_detected'      // Trade from a target trader
  | 'order_computed'      // Strategy computed a copy order
  | 'order_submitted'     // Order sent to Polymarket
  | 'order_filled'        // Order was filled
  | 'order_cancelled'     // Order was cancelled
  | 'order_failed'        // Order submission failed
  | 'position_updated'    // Position changed
  | 'risk_breach'         // Risk limit exceeded
  | 'kill_switch'         // Emergency stop activated
  | 'error';              // System error

/**
 * Base interface for all events
 */
export interface BaseEvent {
  /** Type of event */
  type: EventType;
  
  /** When the event occurred */
  timestamp: number;
  
  /** User this event relates to (if applicable) */
  userId?: string;
}

/**
 * Trade received from WebSocket (before filtering)
 */
export interface TradeReceivedEvent extends BaseEvent {
  type: 'trade_received';
  trade: TradeEvent;
}

/**
 * Trade detected from a target trader
 */
export interface TradeDetectedEvent extends BaseEvent {
  type: 'trade_detected';
  trade: DetectedTrade;
}

/**
 * Strategy has computed a copy order
 */
export interface OrderComputedEvent extends BaseEvent {
  type: 'order_computed';
  userId: string;
  originalTrade: DetectedTrade;
  orderSpec: OrderSpec;
}

/**
 * Order was submitted to Polymarket
 */
export interface OrderSubmittedEvent extends BaseEvent {
  type: 'order_submitted';
  userId: string;
  orderSpec: OrderSpec;
  result: OrderResult;
}

/**
 * Order was filled (fully or partially)
 */
export interface OrderFilledEvent extends BaseEvent {
  type: 'order_filled';
  userId: string;
  orderId: string;
  fill: Fill;
}

/**
 * Order was cancelled
 */
export interface OrderCancelledEvent extends BaseEvent {
  type: 'order_cancelled';
  userId: string;
  orderId: string;
  reason: string;
}

/**
 * Order submission failed
 */
export interface OrderFailedEvent extends BaseEvent {
  type: 'order_failed';
  userId: string;
  orderSpec: OrderSpec;
  error: string;
}

/**
 * Risk limit was breached
 */
export interface RiskBreachEvent extends BaseEvent {
  type: 'risk_breach';
  userId: string;
  breachType: 'daily_loss' | 'total_loss' | 'position_limit';
  currentValue: number;
  limitValue: number;
  message: string;
}

/**
 * Kill-switch activated
 */
export interface KillSwitchEvent extends BaseEvent {
  type: 'kill_switch';
  userId: string;
  reason: string;
  activatedBy: 'system' | 'user';
}

/**
 * System error
 */
export interface ErrorEvent extends BaseEvent {
  type: 'error';
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
}

/**
 * Union type of all events
 */
export type SystemEvent =
  | TradeReceivedEvent
  | TradeDetectedEvent
  | OrderComputedEvent
  | OrderSubmittedEvent
  | OrderFilledEvent
  | OrderCancelledEvent
  | OrderFailedEvent
  | RiskBreachEvent
  | KillSwitchEvent
  | ErrorEvent;
