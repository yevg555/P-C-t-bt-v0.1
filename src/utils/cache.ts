interface CacheItem<T> {
  value: T;
  timestamp: number;
}

/**
 * Generic Cache class with TTL support
 */
export class Cache<T> {
  private cache = new Map<string, CacheItem<T>>();

  constructor(private ttlMs: number) {}

  /**
   * Get value if it exists and is not expired
   */
  get(key: string): T | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;

    if (Date.now() - item.timestamp > this.ttlMs) {
      return undefined;
    }

    return item.value;
  }

  /**
   * Get value even if it is expired
   */
  getStale(key: string): T | undefined {
      const item = this.cache.get(key);
      return item?.value;
  }

  set(key: string, value: T): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  clear(): void {
    this.cache.clear();
  }

  setTtl(ttlMs: number): void {
    this.ttlMs = ttlMs;
  }
}
