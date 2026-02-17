/**
 * RETRY WITH EXPONENTIAL BACKOFF + CIRCUIT BREAKER
 * =================================================
 * Reusable utility for resilient API calls.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay cap in ms (default: 16000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Only retry if this predicate returns true for the error */
  retryIf?: (error: unknown) => boolean;
}

/**
 * Execute an async function with retry and exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 16000,
    backoffMultiplier = 2,
    retryIf = isTransientError,
  } = options;

  let lastError: unknown;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !retryIf(error)) {
        throw error;
      }

      console.warn(`[RETRY] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${delay}ms...`);
      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Simple circuit breaker that opens after N consecutive failures
 * and resets after a cooldown period.
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: "closed" | "open" | "half-open" = "closed";

  constructor(
    private readonly failureThreshold: number = 5,
    private readonly cooldownMs: number = 30_000,
  ) {}

  /**
   * Check if the circuit allows a request.
   * Returns true if allowed, false if the circuit is open.
   */
  allowRequest(): boolean {
    if (this.state === "closed") return true;

    if (this.state === "open") {
      // Check if cooldown has elapsed
      if (Date.now() - this.lastFailureTime >= this.cooldownMs) {
        this.state = "half-open";
        return true; // Allow one probe request
      }
      return false;
    }

    // half-open: allow the probe
    return true;
  }

  /**
   * Record a successful call (resets the breaker).
   */
  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  /**
   * Record a failed call (may trip the breaker).
   */
  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = "open";
    }
  }

  getState(): string {
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }
}

/**
 * Default check for transient (retryable) errors.
 */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Network errors
    if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("etimedout")) return true;
    if (msg.includes("socket hang up") || msg.includes("network") || msg.includes("fetch failed")) return true;
    // HTTP 429 (rate limit) or 5xx
    if (msg.includes("429") || msg.includes("rate limit")) return true;
    if (msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("504")) return true;
    if (msg.includes("internal server error") || msg.includes("bad gateway") || msg.includes("service unavailable")) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
