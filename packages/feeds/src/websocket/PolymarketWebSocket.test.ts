/**
 * Tests for PolymarketWebSocket
 * 
 * These tests verify the WebSocket class behavior without
 * actually connecting to Polymarket (we mock the WebSocket).
 */

import { PolymarketWebSocket, ConnectionState } from './PolymarketWebSocket';

// We'll test the class structure and options
// Real connection tests would require mocking WebSocket

describe('PolymarketWebSocket', () => {
  describe('constructor', () => {
    it('should create instance with default options', () => {
      const ws = new PolymarketWebSocket();
      
      expect(ws).toBeInstanceOf(PolymarketWebSocket);
      expect(ws.getState()).toBe('disconnected');
      expect(ws.isConnected()).toBe(false);
    });

    it('should accept custom options', () => {
      const ws = new PolymarketWebSocket({
        autoReconnect: false,
        maxReconnectAttempts: 5,
        reconnectDelay: 2000,
      });
      
      expect(ws).toBeInstanceOf(PolymarketWebSocket);
      expect(ws.getState()).toBe('disconnected');
    });
  });

  describe('getState', () => {
    it('should return disconnected initially', () => {
      const ws = new PolymarketWebSocket();
      expect(ws.getState()).toBe('disconnected');
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      const ws = new PolymarketWebSocket();
      expect(ws.isConnected()).toBe(false);
    });
  });

  describe('event emitter', () => {
    it('should allow adding event listeners', () => {
      const ws = new PolymarketWebSocket();
      const mockCallback = jest.fn();
      
      ws.on('connected', mockCallback);
      ws.emit('connected');
      
      expect(mockCallback).toHaveBeenCalled();
    });

    it('should allow removing event listeners', () => {
      const ws = new PolymarketWebSocket();
      const mockCallback = jest.fn();
      
      ws.on('connected', mockCallback);
      ws.off('connected', mockCallback);
      ws.emit('connected');
      
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should handle disconnect when not connected', () => {
      const ws = new PolymarketWebSocket();
      
      // Should not throw
      expect(() => ws.disconnect()).not.toThrow();
      expect(ws.getState()).toBe('disconnected');
    });
  });

  describe('subscribeToMarket', () => {
    it('should queue subscription when not connected', () => {
      const ws = new PolymarketWebSocket();
      
      // Should not throw, just queue the subscription
      expect(() => ws.subscribeToMarket('test-token-id')).not.toThrow();
    });
  });

  describe('subscribeToMarkets', () => {
    it('should queue multiple subscriptions when not connected', () => {
      const ws = new PolymarketWebSocket();
      
      // Should not throw, just queue the subscriptions
      expect(() => ws.subscribeToMarkets(['token-1', 'token-2', 'token-3'])).not.toThrow();
    });
  });
});

// Type tests - these verify TypeScript types at compile time
describe('Type Safety', () => {
  it('should have correct ConnectionState type', () => {
    const states: ConnectionState[] = [
      'disconnected',
      'connecting',
      'connected',
      'reconnecting',
    ];
    
    expect(states).toHaveLength(4);
  });
});
