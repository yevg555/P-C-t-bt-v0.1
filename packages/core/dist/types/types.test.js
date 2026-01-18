"use strict";
/**
 * Type Tests
 *
 * These tests verify that our types work correctly.
 * Types themselves don't have runtime behavior, but we can test:
 * 1. That objects conforming to types are valid
 * 2. That default values work
 * 3. That type guards work (if we add them later)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('Trade Types', () => {
    it('should create a valid TradeEvent', () => {
        const trade = {
            orderId: 'order-123',
            makerAddress: '0x1234567890abcdef1234567890abcdef12345678',
            tokenId: 'token-abc',
            side: 'BUY',
            price: 0.65,
            size: 100,
            timestamp: Date.now(),
            orderType: 'GTC',
        };
        expect(trade.orderId).toBe('order-123');
        expect(trade.side).toBe('BUY');
        expect(trade.price).toBeGreaterThan(0);
        expect(trade.price).toBeLessThan(1);
    });
    it('should create a valid DetectedTrade', () => {
        const detected = {
            orderId: 'order-456',
            makerAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
            tokenId: 'token-xyz',
            side: 'SELL',
            price: 0.35,
            size: 50,
            timestamp: Date.now(),
            orderType: 'GTD',
            targetTraderId: 'trader-1',
            detectedAt: Date.now(),
        };
        expect(detected.targetTraderId).toBe('trader-1');
        expect(detected.detectedAt).toBeGreaterThan(0);
    });
});
describe('Order Types', () => {
    it('should create a valid OrderSpec', () => {
        const spec = {
            tokenId: 'token-123',
            side: 'BUY',
            price: 0.55,
            size: 25,
            orderType: 'GTC',
        };
        expect(spec.tokenId).toBe('token-123');
        expect(spec.postOnly).toBeUndefined(); // Optional field
    });
    it('should create an OrderSpec with all optional fields', () => {
        const spec = {
            tokenId: 'token-123',
            side: 'SELL',
            price: 0.45,
            size: 30,
            orderType: 'GTD',
            expiration: Date.now() + 3600000, // 1 hour from now
            postOnly: true,
        };
        expect(spec.expiration).toBeGreaterThan(Date.now());
        expect(spec.postOnly).toBe(true);
    });
});
describe('Position Types', () => {
    it('should create a valid Position', () => {
        const position = {
            id: 'pos-1',
            userId: 'user-1',
            tokenId: 'token-abc',
            quantity: 100,
            averageEntryPrice: 0.50,
            currentMarketPrice: 0.55,
            unrealizedPnl: 5, // (0.55 - 0.50) * 100
            lastUpdated: new Date(),
        };
        expect(position.quantity).toBe(100);
        expect(position.unrealizedPnl).toBe(5);
    });
    it('should handle negative P&L', () => {
        const position = {
            id: 'pos-2',
            userId: 'user-1',
            tokenId: 'token-xyz',
            quantity: 100,
            averageEntryPrice: 0.60,
            currentMarketPrice: 0.50,
            unrealizedPnl: -10, // (0.50 - 0.60) * 100
            lastUpdated: new Date(),
        };
        expect(position.unrealizedPnl).toBe(-10);
    });
});
describe('Config Types', () => {
    it('should have valid DEFAULT_COPY_CONFIG', () => {
        expect(index_1.DEFAULT_COPY_CONFIG.sizingMethod).toBe('proportional_to_portfolio');
        expect(index_1.DEFAULT_COPY_CONFIG.portfolioPercentage).toBe(0.05);
        expect(index_1.DEFAULT_COPY_CONFIG.maxDailyLoss).toBe(100);
        expect(index_1.DEFAULT_COPY_CONFIG.maxTotalLoss).toBe(500);
    });
    it('should create a custom CopyConfig', () => {
        const config = {
            sizingMethod: 'proportional_to_trader',
            traderFraction: 0.25, // Copy 25% of trader's size
            priceOffsetBps: 50, // +0.5% price offset
            maxPositionPerToken: 500,
            maxTotalPosition: 2000,
            minOrderSize: 5,
            minSizePolicy: 'place_minimum',
            maxDailyLoss: 50,
            maxTotalLoss: 200,
        };
        expect(config.sizingMethod).toBe('proportional_to_trader');
        expect(config.traderFraction).toBe(0.25);
    });
});
describe('Event Types', () => {
    it('should create a trade_detected event', () => {
        const event = {
            type: 'trade_detected',
            timestamp: Date.now(),
            userId: 'user-1',
            trade: {
                orderId: 'order-789',
                makerAddress: '0x1234...',
                tokenId: 'token-123',
                side: 'BUY',
                price: 0.60,
                size: 75,
                timestamp: Date.now(),
                orderType: 'GTC',
                targetTraderId: 'trader-2',
                detectedAt: Date.now(),
            },
        };
        expect(event.type).toBe('trade_detected');
        if (event.type === 'trade_detected') {
            expect(event.trade.targetTraderId).toBe('trader-2');
        }
    });
    it('should create a kill_switch event', () => {
        const event = {
            type: 'kill_switch',
            timestamp: Date.now(),
            userId: 'user-1',
            reason: 'Daily loss limit exceeded: -$150',
            activatedBy: 'system',
        };
        expect(event.type).toBe('kill_switch');
        if (event.type === 'kill_switch') {
            expect(event.activatedBy).toBe('system');
        }
    });
});
