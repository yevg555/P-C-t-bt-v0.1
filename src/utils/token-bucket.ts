/**
 * Token Bucket Rate Limiter
 *
 * Implements a token bucket algorithm to allow bursts while enforcing a steady average rate.
 * Uses a "debt" model where tokens can go negative to schedule future requests.
 */
export class TokenBucket {
  private capacity: number;
  private refillRate: number; // tokens per ms
  private tokens: number;
  private lastRefillTime: number;

  /**
   * @param capacity Max burst size (tokens)
   * @param refillRatePerSecond Tokens per second (e.g. 150 req/sec = 150)
   */
  constructor(capacity: number, refillRatePerSecond: number) {
    this.capacity = capacity;
    this.refillRate = refillRatePerSecond / 1000;
    this.tokens = capacity;
    this.lastRefillTime = Date.now();
  }

  /**
   * Consumes tokens from the bucket.
   * If not enough tokens are available, returns a promise that resolves after the necessary wait time.
   * @param count Number of tokens to consume (default 1)
   */
  async consume(count: number = 1): Promise<void> {
    this.refill();

    if (this.tokens >= count) {
      this.tokens -= count;
      return;
    }

    // Not enough tokens. Calculate deficit.
    // We allow tokens to go negative to track debt/wait time.
    // Deficit = tokens needed - current tokens
    // Since current tokens is less than count (and could be negative), this calculates total tokens to refill.
    // Example: tokens = -1, count = 1. We need to fill the hole of -1 AND get +1. Total 2 tokens needed.
    // waitTime = 2 / rate.

    // However, logic check:
    // If tokens = 0. count = 1. deficit = 1. wait = 1/rate.
    // If tokens = -1. count = 1. deficit = 2. wait = 2/rate.
    // This assumes we start waiting from NOW.
    // Yes, because lastRefillTime is NOW.
    // So we need to generate 2 tokens starting from NOW.

    const deficit = count - this.tokens;
    const waitTime = Math.ceil(deficit / this.refillRate);

    // Apply the consumption immediately (increasing debt)
    this.tokens -= count;

    // Wait for the refill time
    await this.sleep(waitTime);
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;

    if (elapsed > 0) {
      const newTokens = elapsed * this.refillRate;
      // We cap at capacity.
      // Note: If we are in debt (tokens < 0), adding newTokens reduces the debt.
      // We only cap if we exceed capacity.
      this.tokens = Math.min(this.capacity, this.tokens + newTokens);
      this.lastRefillTime = now;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
