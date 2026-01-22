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
 * Portfolio value response from the API
 * Can be either an array or single object
 */
interface PortfolioValueResponseItem {
  user?: string;
  value?: string | number;
  total?: string | number;
  portfolio_value?: string | number;
}

type PortfolioValueResponse = PortfolioValueResponseItem | PortfolioValueResponseItem[];

/**
 * Cached portfolio value with timestamp
 */
interface CachedPortfolioValue {
  value: number;
  timestamp: number;
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

  // Portfolio value cache: address -> cached value
  private portfolioValueCache: Map<string, CachedPortfolioValue> = new Map();
  // Cache TTL in milliseconds (default 30 seconds)
  private portfolioValueCacheTtlMs: number = 30000;

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
  // PORTFOLIO VALUE (Data API)
  // ===================================

  /**
   * Get total portfolio value for a wallet address
   * Uses caching to reduce API calls and latency
   *
   * @param address - Wallet address
   * @param options - Options for fetching
   * @param options.forceRefresh - Bypass cache and fetch fresh value
   * @returns Total portfolio value in USD
   *
   * @example
   * const value = await api.getPortfolioValue(traderAddress);
   * console.log(`Trader portfolio: $${value}`);
   */
  async getPortfolioValue(
    address: string,
    options: { forceRefresh?: boolean } = {}
  ): Promise<number> {
    const { forceRefresh = false } = options;

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this.portfolioValueCache.get(address);
      if (cached && Date.now() - cached.timestamp < this.portfolioValueCacheTtlMs) {
        return cached.value;
      }
    }

    await this.respectRateLimit();

    const url = `${this.dataApiUrl}/value?user=${address}`;

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

      const data = (await response.json()) as PortfolioValueResponse;

      // Parse value from response - handle array or object format
      // API returns: [{"user":"0x...", "value": 47766.0034}] or {"value": 47766.0034}
      let item: PortfolioValueResponseItem;
      if (Array.isArray(data)) {
        // Array format - find matching user or take first item
        item = data.find(d => d.user?.toLowerCase() === address.toLowerCase()) || data[0] || {};
      } else {
        item = data || {};
      }

      const rawValue = item.value ?? item.total ?? item.portfolio_value ?? 0;
      const value = typeof rawValue === "string" ? parseFloat(rawValue) : rawValue;

      // Cache the result
      this.portfolioValueCache.set(address, {
        value,
        timestamp: Date.now(),
      });

      return value;
    } catch (error) {
      if (error instanceof Error) {
        console.error(`[API] getPortfolioValue error: ${error.message}`);
      }

      // Return cached value if available (even if stale)
      const cached = this.portfolioValueCache.get(address);
      if (cached) {
        console.warn(`[API] Using stale cached portfolio value for ${address.slice(0, 10)}...`);
        return cached.value;
      }

      throw error;
    }
  }

  /**
   * Get portfolio value with pre-fetching for reduced latency
   * Call this periodically to keep cache warm
   *
   * @param address - Wallet address
   */
  async prefetchPortfolioValue(address: string): Promise<void> {
    try {
      await this.getPortfolioValue(address, { forceRefresh: true });
    } catch (error) {
      // Silently fail for prefetch - cache will be used as fallback
      console.warn(`[API] Prefetch portfolio value failed: ${error}`);
    }
  }

  /**
   * Set portfolio value cache TTL
   *
   * @param ttlMs - Cache TTL in milliseconds
   */
  setPortfolioValueCacheTtl(ttlMs: number): void {
    this.portfolioValueCacheTtlMs = ttlMs;
  }

  /**
   * Get cached portfolio value (if available)
   * Returns undefined if not cached or cache is stale
   *
   * @param address - Wallet address
   */
  getCachedPortfolioValue(address: string): number | undefined {
    const cached = this.portfolioValueCache.get(address);
    if (cached && Date.now() - cached.timestamp < this.portfolioValueCacheTtlMs) {
      return cached.value;
    }
    return undefined;
  }

  /**
   * Clear portfolio value cache
   */
  clearPortfolioValueCache(): void {
    this.portfolioValueCache.clear();
  }

  // ===================================
  // TRADES / ACTIVITY (Data API)
  // ===================================

  /**
   * Fetch recent trades/activity for a wallet address
   *
   * @param address - Wallet address
   * @param options - Query options
   * @param options.limit - Max number of trades to return (default 100)
   * @param options.after - Unix timestamp (seconds) - only return trades after this time
   * @returns Array of trades, most recent first
   *
   * @example
   * // Get all recent trades
   * const trades = await api.getTrades(address);
   *
   * // Get trades after a specific timestamp (for incremental updates)
   * const lastTradeTime = Math.floor(lastTrade.timestamp.getTime() / 1000);
   * const newTrades = await api.getTrades(address, { after: lastTradeTime });
   */
  async getTrades(
    address: string,
    options: { limit?: number; after?: number } = {}
  ): Promise<Trade[]> {
    await this.respectRateLimit();

    const { limit = 100, after } = options;

    let url = `${this.dataApiUrl}/activity?user=${address}&limit=${limit}`;

    // Add 'after' parameter for incremental fetching
    if (after !== undefined) {
      url += `&after=${after}`;
    }

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
   * @param options - Query options (limit, after)
   */
  async getTradesForToken(
    address: string,
    tokenId: string,
    options: { limit?: number; after?: number } = {}
  ): Promise<Trade[]> {
    const { limit = 50, after } = options;
    const allTrades = await this.getTrades(address, { limit: limit * 2, after });
    return allTrades.filter((t) => t.tokenId === tokenId).slice(0, limit);
  }

  /**
   * Get the most recent trade for a wallet
   */
  async getLatestTrade(address: string): Promise<Trade | null> {
    const trades = await this.getTrades(address, { limit: 1 });
    return trades.length > 0 ? trades[0] : null;
  }

  /**
   * Get new trades since a specific timestamp
   * Useful for incremental polling - only fetch trades we haven't seen
   *
   * @param address - Wallet address
   * @param sinceTimestamp - Date object or Unix timestamp (seconds)
   * @returns Array of new trades since the timestamp
   *
   * @example
   * // Track new trades incrementally
   * let lastCheckTime = Date.now();
   *
   * // Later, get only new trades
   * const newTrades = await api.getTradesSince(address, lastCheckTime);
   * if (newTrades.length > 0) {
   *   lastCheckTime = newTrades[0].timestamp.getTime(); // Update to most recent
   *   // Process new trades...
   * }
   */
  async getTradesSince(
    address: string,
    sinceTimestamp: Date | number,
    limit: number = 100
  ): Promise<Trade[]> {
    const afterUnix =
      typeof sinceTimestamp === "number"
        ? sinceTimestamp < 1e12
          ? sinceTimestamp // Already in seconds
          : Math.floor(sinceTimestamp / 1000) // Convert ms to seconds
        : Math.floor(sinceTimestamp.getTime() / 1000); // Date to seconds

    return this.getTrades(address, { limit, after: afterUnix });
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
