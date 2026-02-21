/**
 * RATE LIMITER
 * ============
 * Simple token bucket style rate limiter to respect API limits.
 * Ensures a minimum interval between requests.
 */

export class RateLimiter {
  private lastRequestTime = 0;
  private minInterval: number;

  /**
   * @param minIntervalMs - Minimum interval between requests in milliseconds
   */
  constructor(minIntervalMs: number) {
    this.minInterval = minIntervalMs;
  }

  /**
   * Wait until enough time has passed since the last request.
   * Updates the last request time after waiting.
   */
  async waitForToken(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minInterval) {
      const waitTime = this.minInterval - timeSinceLastRequest;
      await this.sleep(waitTime);
    }

    this.lastRequestTime = Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
