/**
 * Global Configuration
 */

export const API_CONFIG = {
  keepAliveTimeout: 30_000,      // Keep idle connections alive for 30s
  keepAliveMaxTimeout: 60_000,   // Max keep-alive duration
  connections: 10,               // Max concurrent connections per origin
  pipelining: 1,                 // HTTP pipelining (1 = disabled, safe default)
};

export const API_URLS = {
  data: "https://data-api.polymarket.com",
  clob: "https://clob.polymarket.com",
};

export const RATE_LIMITS = {
  activityRequestInterval: 100, // 10 req/sec for /activity
  positionsRequestInterval: 67, // 15 req/sec for /positions
  clobRequestInterval: 7,       // 150 req/sec for CLOB /price & /book
};

export const CACHE_TTL = {
  portfolioValue: 30_000, // 30 seconds
  price: 5_000,           // 5 seconds
  orderBook: 5_000,       // 5 seconds
};
