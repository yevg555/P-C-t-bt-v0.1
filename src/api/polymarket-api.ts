/**
 * POLYMARKET API CLIENT
 * =====================
 *
 * Two APIs:
 *   - Data API (data-api.polymarket.com): Positions, activity, trades
 *   - CLOB API (clob.polymarket.com): Prices, orderbook, orders
 *
 * IMPORTANT - API SIDE TERMINOLOGY:
 *   /price?side=BUY  → Returns best BID (what buyers are offering)
 *   /price?side=SELL → Returns best ASK (what sellers are asking)
 *
 *   So to execute a BUY order, we need the ASK → call with side=SELL
 *   And to execute a SELL order, we need the BID → call with side=BUY
 *
 * Rate Limit: 15 requests/second
 */

import { Position, RawPositionResponse } from "../types";

// Response types
interface PriceResponse {
  price?: string;
}

interface MidpointResponse {
  mid?: string;
}

interface SpreadResponse {
  spread?: string;
}

interface OrderBookResponse {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
}

/**
 * Raw trade/activity response from the API
 */
export interface RawTradeResponse {
  id?: string;
  taker_order_id?: string;
  market?: string;
  asset?: string;
  token_id?: string;
  side?: "BUY" | "SELL";
  size?: string | number;
  price?: string | number;
  status?: string;
  timestamp?: string;
  transaction_hash?: string;
  outcome?: string;
  title?: string;
}

/**
 * Normalized trade/activity record
 */
export interface Trade {
  id: string;
  tokenId: string;
  marketId: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  timestamp: Date;
  transactionHash?: string;
  marketTitle?: string;
  outcome?: string;
}

// Extended position with curPrice
export interface PositionWithPrice extends Position {
  curPrice: number;
}

export class PolymarketAPI {
  private dataApiUrl = "https://data-api.polymarket.com";
  private clobApiUrl = "https://clob.polymarket.com";

  // Rate limiting
  private lastRequestTime = 0;
  private minRequestInterval = 67; // ~15 requests/sec max

  // ===================================
  // POSITIONS (Data API)
  // ===================================

  /**
   * Fetch all positions for a wallet address
   * Includes curPrice from API!
   */
  async getPositions(address: string): Promise<Position[]> {
    await this.respectRateLimit();

    const url = `${this.dataApiUrl}/positions?user=${address}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("RATE_LIMITED: Too many requests");
        }
        throw new Error(`API_ERROR: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as unknown;
      return this.transformPositions(data);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[API] getPositions error: ${error.message}`);
      }
      throw error;
    }
  }

  // ===================================
  // TRADES / ACTIVITY (Data API)
  // ===================================

  /**
   * Fetch recent trades/activity for a wallet address
   *
   * @param address - Wallet address
   * @param limit - Max number of trades to return (default 100)
   * @returns Array of trades, most recent first
   */
  async getTrades(address: string, limit: number = 100): Promise<Trade[]> {
    await this.respectRateLimit();

    const url = `${this.dataApiUrl}/activity?user=${address}&limit=${limit}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("RATE_LIMITED: Too many requests");
        }
        throw new Error(`API_ERROR: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as unknown;
      return this.transformTrades(data);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[API] getTrades error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get trades for a specific market/token
   *
   * @param address - Wallet address
   * @param tokenId - Token ID to filter by
   * @param limit - Max number of trades
   */
  async getTradesForToken(
    address: string,
    tokenId: string,
    limit: number = 50
  ): Promise<Trade[]> {
    const allTrades = await this.getTrades(address, limit * 2); // Fetch extra to filter
    return allTrades.filter((t) => t.tokenId === tokenId).slice(0, limit);
  }

  /**
   * Get the most recent trade for a wallet
   */
  async getLatestTrade(address: string): Promise<Trade | null> {
    const trades = await this.getTrades(address, 1);
    return trades.length > 0 ? trades[0] : null;
  }

  // ===================================
  // PRICING (CLOB API)
  // ===================================

  /**
   * Get the execution price for a trade
   *
   * IMPORTANT: Maps our trade intent to correct API parameter!
   *   - tradeIntent='BUY'  → we need ASK → API side=SELL
   *   - tradeIntent='SELL' → we need BID → API side=BUY
   *
   * @param tokenId - The token ID
   * @param tradeIntent - What YOU want to do: 'BUY' or 'SELL'
   * @returns The price you'll pay (for BUY) or receive (for SELL)
   */
  async getPrice(
    tokenId: string,
    tradeIntent: "BUY" | "SELL",
  ): Promise<number> {
    await this.respectRateLimit();

    // FLIP THE SIDE!
    // To BUY, we need sellers (ASK) → API side=SELL
    // To SELL, we need buyers (BID) → API side=BUY
    const apiSide = tradeIntent === "BUY" ? "SELL" : "BUY";

    const url = `${this.clobApiUrl}/price?token_id=${tokenId}&side=${apiSide}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        console.error(`[API] Price endpoint returned: ${response.status}`);
        throw new Error(`Price API error: ${response.status}`);
      }

      const data = (await response.json()) as PriceResponse;
      const price = parseFloat(data.price || "0");

      if (price <= 0 || price >= 1) {
        console.warn(
          `[API] Invalid price returned: ${price} for tradeIntent=${tradeIntent} (apiSide=${apiSide})`,
        );
      }

      return price;
    } catch (error) {
      console.error(`[API] getPrice failed: ${error}`);
      throw error;
    }
  }

  /**
   * Get both execution prices at once
   *
   * @returns {
   *   buyAt: price to BUY at (best ASK),
   *   sellAt: price to SELL at (best BID),
   *   spread: buyAt - sellAt
   * }
   */
  async getPriceBothSides(tokenId: string): Promise<{
    buyAt: number; // Best ASK - price to buy at
    sellAt: number; // Best BID - price to sell at
    spread: number;
    spreadPercent: number;
  }> {
    const buyAt = await this.getPrice(tokenId, "BUY"); // Gets ASK
    const sellAt = await this.getPrice(tokenId, "SELL"); // Gets BID

    const spread = buyAt - sellAt; // Should be positive (ASK > BID)
    const spreadPercent = sellAt > 0 ? (spread / sellAt) * 100 : 0;

    return { buyAt, sellAt, spread, spreadPercent };
  }

  /**
   * Get raw BID or ASK price (direct API call without flipping)
   * Use this if you want the raw API behavior
   */
  async getRawPrice(tokenId: string, side: "BUY" | "SELL"): Promise<number> {
    await this.respectRateLimit();

    const url = `${this.clobApiUrl}/price?token_id=${tokenId}&side=${side}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Price API error: ${response.status}`);
    }

    const data = (await response.json()) as PriceResponse;
    return parseFloat(data.price || "0");
  }

  /**
   * Get midpoint price (best bid + best ask / 2)
   * Good for estimation, NOT for execution
   */
  async getMidpoint(tokenId: string): Promise<number> {
    await this.respectRateLimit();

    const url = `${this.clobApiUrl}/midpoint?token_id=${tokenId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Midpoint API error: ${response.status}`);
    }

    const data = (await response.json()) as MidpointResponse;
    return parseFloat(data.mid || "0");
  }

  /**
   * Get spread directly from API
   */
  async getSpread(tokenId: string): Promise<number> {
    await this.respectRateLimit();

    const url = `${this.clobApiUrl}/spread?token_id=${tokenId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Spread API error: ${response.status}`);
    }

    const data = (await response.json()) as SpreadResponse;
    return parseFloat(data.spread || "0");
  }

  /**
   * Get order book for a token
   */
  async getOrderBook(tokenId: string): Promise<{
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
  }> {
    await this.respectRateLimit();

    const url = `${this.clobApiUrl}/book?token_id=${tokenId}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`OrderBook API error: ${response.status}`);
    }

    const data = (await response.json()) as OrderBookResponse;

    return {
      bids: data.bids || [],
      asks: data.asks || [],
    };
  }

  // ===================================
  // HELPER METHODS
  // ===================================

  private async respectRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await this.sleep(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  private transformPositions(data: unknown): Position[] {
    if (!data) return [];

    let positions: unknown[];

    if (Array.isArray(data)) {
      positions = data;
    } else if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      positions = (obj.positions || obj.data || []) as unknown[];
    } else {
      positions = [];
    }

    if (!Array.isArray(positions)) {
      console.warn("[API] Unexpected response format:", typeof data);
      return [];
    }

    return positions
      .map((item) => this.transformPosition(item as RawPositionResponse))
      .filter((p): p is Position => p !== null && p.quantity > 0);
  }

  private transformPosition(item: RawPositionResponse): Position | null {
    try {
      const tokenId = item.asset || item.token_id || item.tokenId;
      const rawSize = item.size ?? item.quantity;
      const quantity =
        typeof rawSize === "string" ? parseFloat(rawSize) : rawSize || 0;

      if (!tokenId || isNaN(quantity)) {
        return null;
      }

      // Parse avgPrice
      const rawAvgPrice = item.avgPrice ?? item.avg_price;
      const avgPrice =
        typeof rawAvgPrice === "string"
          ? parseFloat(rawAvgPrice)
          : rawAvgPrice || 0;

      // Parse curPrice
      const rawCurPrice = item.curPrice;
      const curPrice =
        typeof rawCurPrice === "string"
          ? parseFloat(rawCurPrice)
          : rawCurPrice || 0;

      return {
        tokenId,
        marketId: item.conditionId || item.condition_id || item.market || "",
        quantity,
        avgPrice,
        curPrice,
        marketTitle: item.title || item.market_title,
        outcome: item.outcome,
      };
    } catch (error) {
      console.error(`[API] transformPosition failed:`, error);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ===================================
  // TRADE TRANSFORMATION
  // ===================================

  private transformTrades(data: unknown): Trade[] {
    if (!data) return [];

    let trades: unknown[];

    if (Array.isArray(data)) {
      trades = data;
    } else if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      trades = (obj.history || obj.activity || obj.trades || obj.data || []) as unknown[];
    } else {
      trades = [];
    }

    if (!Array.isArray(trades)) {
      console.warn("[API] Unexpected trades response format:", typeof data);
      return [];
    }

    return trades
      .map((item) => this.transformTrade(item as RawTradeResponse))
      .filter((t): t is Trade => t !== null);
  }

  private transformTrade(item: RawTradeResponse): Trade | null {
    try {
      const id = item.id || item.taker_order_id || "";
      const tokenId = item.asset || item.token_id || "";
      const side = item.side || "BUY";

      const rawSize = item.size;
      const size = typeof rawSize === "string" ? parseFloat(rawSize) : rawSize || 0;

      const rawPrice = item.price;
      const price = typeof rawPrice === "string" ? parseFloat(rawPrice) : rawPrice || 0;

      if (!tokenId || size <= 0) {
        return null;
      }

      return {
        id,
        tokenId,
        marketId: item.market || "",
        side,
        size,
        price,
        timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
        transactionHash: item.transaction_hash,
        marketTitle: item.title,
        outcome: item.outcome,
      };
    } catch (error) {
      console.error(`[API] transformTrade failed:`, error);
      return null;
    }
  }
}
