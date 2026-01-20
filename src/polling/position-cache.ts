/**
 * POSITION CACHE
 * ==============
 * Stores the last known positions for quick comparison.
 * 
 * Think of it as a "snapshot" - we compare new data against
 * this snapshot to detect changes.
 * 
 * Currently in-memory. Could be Redis-backed for production.
 */

import { Position } from '../types';

export class PositionCache {
  /** Map of tokenId -> Position */
  private cache: Map<string, Position> = new Map();
  
  /** When was this cache last updated? */
  private lastUpdated: Date | null = null;
  
  /**
   * Update the cache with a fresh set of positions
   * This REPLACES all previous data
   * 
   * @param positions - New positions from API
   * 
   * @example
   * cache.update([
   *   { tokenId: 'abc', quantity: 100, ... },
   *   { tokenId: 'xyz', quantity: 50, ... },
   * ]);
   */
  update(positions: Position[]): void {
    // Clear old data
    this.cache.clear();
    
    // Store new positions
    for (const position of positions) {
      this.cache.set(position.tokenId, { ...position }); // Clone to avoid mutations
    }
    
    this.lastUpdated = new Date();
  }
  
  /**
   * Get a specific position by token ID
   * 
   * @param tokenId - The token to look up
   * @returns The position, or undefined if not found
   */
  get(tokenId: string): Position | undefined {
    const pos = this.cache.get(tokenId);
    return pos ? { ...pos } : undefined; // Return a clone
  }
  
  /**
   * Get all cached positions
   * 
   * @returns Array of all positions
   */
  getAll(): Position[] {
    return Array.from(this.cache.values()).map(p => ({ ...p })); // Clone all
  }
  
  /**
   * Get all token IDs in the cache
   */
  getTokenIds(): string[] {
    return Array.from(this.cache.keys());
  }
  
  /**
   * Check if a position exists in cache
   */
  has(tokenId: string): boolean {
    return this.cache.has(tokenId);
  }
  
  /**
   * How many positions are cached?
   */
  size(): number {
    return this.cache.size;
  }
  
  /**
   * Is the cache empty?
   * (True on first run before any data is loaded)
   */
  isEmpty(): boolean {
    return this.cache.size === 0;
  }
  
  /**
   * When was the cache last updated?
   */
  getLastUpdated(): Date | null {
    return this.lastUpdated;
  }
  
  /**
   * How old is the cache data? (milliseconds)
   * Returns Infinity if never updated
   */
  getAge(): number {
    if (!this.lastUpdated) {
      return Infinity;
    }
    return Date.now() - this.lastUpdated.getTime();
  }
  
  /**
   * Clear all cached positions
   */
  clear(): void {
    this.cache.clear();
    this.lastUpdated = null;
  }
  
  /**
   * Get a summary for logging
   */
  getSummary(): string {
    const age = this.lastUpdated 
      ? `${((Date.now() - this.lastUpdated.getTime()) / 1000).toFixed(1)}s ago`
      : 'never';
    return `PositionCache: ${this.size()} positions, updated ${age}`;
  }
}
