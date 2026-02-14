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
 * Rate Limits (per 10 seconds):
 *   - /activity endpoint: 1000 calls (100/sec) - 5x higher!
 *   - /positions endpoint: 200 calls (20/sec)
 *   - CLOB API: ~150 calls (15/sec)
 */

import { Agent, fetch as undiciFetch } from "undici";
import { Position, RawPositionResponse } from "../types";

/**
 * Undici HTTP agent with persistent keep-alive connections.
 * Eliminates TCP + TLS handshake overhead on repeated API calls (~20-50ms savings per request).
 * Native Node 22 fetch uses undici internally but doesn't expose connection pool tuning.
 */
const keepAliveDispatcher = new Agent({
  keepAliveTimeout: 30_000,      // Keep idle connections alive for 30s
  keepAliveMaxTimeout: 60_000,   // Max keep-alive duration
  connections: 10,               // Max concurrent connections per origin
  pipelining: 1,                 // HTTP pipelining (1 = disabled, safe default)
});

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
 * Cached price with timestamp
 */
interface CachedPrice {
  price: number;
  timestamp: number;
}

/**
 * Raw trade/activity response from the API
 * Based on actual Polymarket /activity endpoint response
 */
export interface RawTradeResponse {
  // Wallet info
  proxyWallet?: string;

  // Identifiers
  transactionHash?: string;
  conditionId?: string;  // This is the market/condition ID
  asset?: string;        // This is the token ID (long number string)

  // Trade details
  type?: string;         // "TRADE" for trades
  side?: "BUY" | "SELL";
  size?: number;         // Number of shares
  usdcSize?: number;     // Cost in USDC
  price?: number;        // Execution price (0-1)

  // Timestamp - Unix timestamp in SECONDS (not ISO string!)
  timestamp?: number;

  // Market info
  title?: string;
  slug?: string;
  eventSlug?: string;
  icon?: string;
  outcome?: string;      // "Up", "Down", "Yes", "No"
  outcomeIndex?: number; // 0 or 1

  // User profile (not needed for copy trading)
  name?: string;
  pseudonym?: string;
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

  /**
   * Wrapper around fetch that uses the keep-alive agent for persistent connections.
   * Saves ~20-50ms per request by reusing TCP connections.
   */
  private async fetch(url: string, init?: RequestInit): Promise<Response> {
    const response = await undiciFetch(url, {
      method: init?.method,
      headers: init?.headers as Record<string, string> | undefined,
      body: init?.body as string | undefined,
      dispatcher: keepAliveDispatcher,
    });
    return response as unknown as Response;
  }

  // Differentiated rate limiting per endpoint type
  // /activity: 1000 calls/10s = 100/sec = 10ms between requests
  // /positions: 200 calls/10s = 20/sec = 50ms between requests
  // CLOB API: ~150 calls/10s = 15/sec = 67ms between requests
  private lastActivityRequestTime = 0;
  private minActivityRequestInterval = 10; // 100 req/sec for /activity

  private lastPositionsRequestTime = 0;
  private minPositionsRequestInterval = 50; // 20 req/sec for /positions

  private lastClobRequestTime = 0;
  private minClobRequestInterval = 67; // 15 req/sec for CLOB API

  // Portfolio value cache: address -> cached value
  private portfolioValueCache: Map<string, CachedPortfolioValue> = new Map();
  // Cache TTL in milliseconds (default 30 seconds)
  private portfolioValueCacheTtlMs: number = 30000;

  // Price cache: "tokenId:side" -> cached price
  private priceCache: Map<string, CachedPrice> = new Map();
  // Price cache TTL in milliseconds (default 5 seconds - prices change frequently)
  private priceCacheTtlMs: number = 5000;

  // ===================================
  // POSITIONS (Data API)
  // ===================================

  /**
   * Fetch all positions for a wallet address
   * Includes curPrice from API!
   */
  async getPositions(address: string): Promise<Position[]> {
    await this.respectPositionsRateLimit();

    const url = `${this.dataApiUrl}/positions?user=${address}`;

    try {
      const response = await this.fetch(url, {
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

    await this.respectPositionsRateLimit();

    const url = `${this.dataApiUrl}/value?user=${address}`;

    try {
      const response = await this.fetch(url, {
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
    await this.respectActivityRateLimit();

    const { limit = 100, after } = options;

    let url = `${this.dataApiUrl}/activity?user=${address}&limit=${limit}`;

    // Add 'after' parameter for incremental fetching
    if (after !== undefined) {
      url += `&after=${after}`;
    }

    try {
      const response = await this.fetch(url, {
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
   * Uses caching to reduce API calls (5s TTL by default)
   *
   * IMPORTANT: Maps our trade intent to correct API parameter!
   *   - tradeIntent='BUY'  → we need ASK → API side=SELL
   *   - tradeIntent='SELL' → we need BID → API side=BUY
   *
   * @param tokenId - The token ID
   * @param tradeIntent - What YOU want to do: 'BUY' or 'SELL'
   * @param options - Options for fetching
   * @param options.skipCache - Bypass cache and fetch fresh price
   * @returns The price you'll pay (for BUY) or receive (for SELL)
   */
  async getPrice(
    tokenId: string,
    tradeIntent: "BUY" | "SELL",
    options: { skipCache?: boolean } = {}
  ): Promise<number> {
    const { skipCache = false } = options;
    const cacheKey = `${tokenId}:${tradeIntent}`;

    // Check cache first
    if (!skipCache) {
      const cached = this.priceCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.priceCacheTtlMs) {
        return cached.price;
      }
    }

    await this.respectClobRateLimit();

    // FLIP THE SIDE!
    // To BUY, we need sellers (ASK) → API side=SELL
    // To SELL, we need buyers (BID) → API side=BUY
    const apiSide = tradeIntent === "BUY" ? "SELL" : "BUY";

    const url = `${this.clobApiUrl}/price?token_id=${tokenId}&side=${apiSide}`;

    try {
      const response = await this.fetch(url, {
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

      // Cache the result
      this.priceCache.set(cacheKey, {
        price,
        timestamp: Date.now(),
      });

      return price;
    } catch (error) {
      console.error(`[API] getPrice failed: ${error}`);

      // Return cached value as fallback (even if stale)
      const cached = this.priceCache.get(cacheKey);
      if (cached) {
        console.warn(`[API] Using stale cached price for ${tokenId.slice(0, 10)}...`);
        return cached.price;
      }

      throw error;
    }
  }

  /**
   * Get prices for multiple tokens in parallel
   * Much faster than sequential calls when fetching many prices
   *
   * @param requests - Array of {tokenId, side} to fetch
   * @returns Map of "tokenId" -> price
   */
  async getPricesParallel(
    requests: Array<{ tokenId: string; side: "BUY" | "SELL" }>
  ): Promise<Map<string, number>> {
    const results = new Map<string, number>();

    // Fetch all prices in parallel
    const promises = requests.map(async ({ tokenId, side }) => {
      try {
        const price = await this.getPrice(tokenId, side);
        return { tokenId, price, success: true };
      } catch {
        return { tokenId, price: 0, success: false };
      }
    });

    const settled = await Promise.all(promises);

    for (const result of settled) {
      if (result.success) {
        results.set(result.tokenId, result.price);
      }
    }

    return results;
  }

  /**
   * Set price cache TTL
   * @param ttlMs - Cache TTL in milliseconds
   */
  setPriceCacheTtl(ttlMs: number): void {
    this.priceCacheTtlMs = ttlMs;
  }

  /**
   * Clear price cache
   */
  clearPriceCache(): void {
    this.priceCache.clear();
  }

  // ===================================
  // PRICE CACHE WARMER
  // ===================================

  private watchedTokenIds: Set<string> = new Set();
  private priceCacheWarmerInterval: NodeJS.Timeout | null = null;

  /**
   * Start warming the price cache for a set of token IDs.
   * Runs a background loop that refreshes CLOB prices for all watched tokens,
   * so when a trade is detected the price is already cached (~0ms instead of ~60-100ms).
   *
   * @param tokenIds - Token IDs to keep warm (typically from trader's current positions)
   * @param intervalMs - How often to refresh (default: 4000ms, just under 5s cache TTL)
   */
  startPriceCacheWarmer(tokenIds: string[], intervalMs: number = 4000): void {
    this.watchedTokenIds = new Set(tokenIds);

    // Stop existing warmer if running
    this.stopPriceCacheWarmer();

    if (this.watchedTokenIds.size === 0) {
      return;
    }

    console.log(`[API] Price cache warmer started: ${this.watchedTokenIds.size} tokens, refreshing every ${intervalMs}ms`);

    // Initial warm-up
    this.warmPriceCache();

    // Periodic refresh
    this.priceCacheWarmerInterval = setInterval(() => {
      this.warmPriceCache();
    }, intervalMs);
  }

  /**
   * Update the set of watched token IDs (e.g. when trader opens/closes positions)
   */
  updateWatchedTokens(tokenIds: string[]): void {
    const oldSize = this.watchedTokenIds.size;
    this.watchedTokenIds = new Set(tokenIds);
    if (this.watchedTokenIds.size !== oldSize) {
      console.log(`[API] Watched tokens updated: ${oldSize} → ${this.watchedTokenIds.size}`);
    }
  }

  /**
   * Stop the price cache warmer
   */
  stopPriceCacheWarmer(): void {
    if (this.priceCacheWarmerInterval) {
      clearInterval(this.priceCacheWarmerInterval);
      this.priceCacheWarmerInterval = null;
    }
  }

  /**
   * Refresh prices for all watched tokens.
   * Fetches BUY side (ASK) prices — the most common need for copy trading.
   * Uses rate-limited sequential calls to avoid overwhelming the CLOB API.
   */
  private async warmPriceCache(): Promise<void> {
    const tokens = Array.from(this.watchedTokenIds);
    for (const tokenId of tokens) {
      try {
        // Warm both BUY and SELL sides
        await this.getPrice(tokenId, "BUY");
      } catch {
        // Silently ignore individual failures — stale cache is still useful
      }
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
    await this.respectClobRateLimit();

    const url = `${this.clobApiUrl}/price?token_id=${tokenId}&side=${side}`;

    const response = await this.fetch(url, {
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
    await this.respectClobRateLimit();

    const url = `${this.clobApiUrl}/midpoint?token_id=${tokenId}`;

    const response = await this.fetch(url, {
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
    await this.respectClobRateLimit();

    const url = `${this.clobApiUrl}/spread?token_id=${tokenId}`;

    const response = await this.fetch(url, {
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
    await this.respectClobRateLimit();

    const url = `${this.clobApiUrl}/book?token_id=${tokenId}`;

    const response = await this.fetch(url, {
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

  /**
   * Rate limit for /activity endpoint (1000 calls/10s = 100/sec)
   * 5x higher limits than positions!
   */
  private async respectActivityRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastActivityRequestTime;

    if (timeSinceLastRequest < this.minActivityRequestInterval) {
      const waitTime = this.minActivityRequestInterval - timeSinceLastRequest;
      await this.sleep(waitTime);
    }

    this.lastActivityRequestTime = Date.now();
  }

  /**
   * Rate limit for /positions endpoint (200 calls/10s = 20/sec)
   */
  private async respectPositionsRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastPositionsRequestTime;

    if (timeSinceLastRequest < this.minPositionsRequestInterval) {
      const waitTime = this.minPositionsRequestInterval - timeSinceLastRequest;
      await this.sleep(waitTime);
    }

    this.lastPositionsRequestTime = Date.now();
  }

  /**
   * Rate limit for CLOB API (prices, orderbook) (~150 calls/10s = 15/sec)
   */
  private async respectClobRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastClobRequestTime;

    if (timeSinceLastRequest < this.minClobRequestInterval) {
      const waitTime = this.minClobRequestInterval - timeSinceLastRequest;
      await this.sleep(waitTime);
    }

    this.lastClobRequestTime = Date.now();
  }

  /**
   * @deprecated Use endpoint-specific rate limiters instead
   */
  private async respectRateLimit(): Promise<void> {
    // Fallback to positions rate limit for backward compatibility
    await this.respectPositionsRateLimit();
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
  // CLOCK SYNCHRONIZATION
  // ===================================

  /**
   * Check clock synchronization with Polymarket servers
   * Returns drift in milliseconds and synchronization status
   *
   * This is critical for accurate latency measurements in copy trading.
   * Detection latency is calculated as: Date.now() - trade.timestamp
   * If clocks are not synchronized, measurements will be inaccurate.
   *
   * @returns Object with drift (ms), network latency, and sync status
   */
  async checkClockSync(): Promise<{
    drift: number;
    networkLatency: number;
    synchronized: boolean;
    localTime: Date;
    serverTime: Date;
  }> {
    const localBefore = Date.now();

    try {
      // Fetch from Polymarket API to get server time
      const response = await this.fetch(`${this.dataApiUrl}/activity?limit=1`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const localAfter = Date.now();
      const serverDateHeader = response.headers.get("date");

      if (!serverDateHeader) {
        throw new Error("No Date header in response");
      }

      const serverTime = new Date(serverDateHeader);
      const networkLatency = localAfter - localBefore;

      // Adjust for network round-trip time (half RTT is approximate one-way latency)
      const localAvg = (localBefore + localAfter) / 2;
      const drift = localAvg - serverTime.getTime();

      // Synchronized if drift is within 100ms
      const synchronized = Math.abs(drift) < 100;

      return {
        drift,
        networkLatency,
        synchronized,
        localTime: new Date(localAvg),
        serverTime,
      };
    } catch (error) {
      throw new Error(`Clock sync check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
      // Only process TRADE type entries
      if (item.type && item.type !== "TRADE") {
        return null;
      }

      // Token ID is in the 'asset' field
      const tokenId = item.asset || "";

      // Use transactionHash as unique ID (actual API doesn't have 'id' field)
      // Combine with timestamp and size for uniqueness across fills in same tx
      const id = `${item.transactionHash || "unknown"}-${item.timestamp || 0}-${item.size || 0}`;

      const side = item.side || "BUY";
      const size = item.size || 0;
      const price = item.price || 0;

      if (!tokenId || size <= 0) {
        return null;
      }

      // Timestamp is Unix seconds - convert to milliseconds for Date
      // The API returns timestamps like 1769294618 (seconds since epoch)
      const timestamp = item.timestamp
        ? new Date(item.timestamp * 1000)
        : new Date();

      return {
        id,
        tokenId,
        marketId: item.conditionId || "",  // conditionId is the market ID
        side,
        size,
        price,
        timestamp,
        transactionHash: item.transactionHash,
        marketTitle: item.title,
        outcome: item.outcome,
      };
    } catch (error) {
      console.error(`[API] transformTrade failed:`, error);
      return null;
    }
  }
}
