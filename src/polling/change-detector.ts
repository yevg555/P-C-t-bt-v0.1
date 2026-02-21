/**
 * CHANGE DETECTOR
 * ===============
 * Compares two position snapshots and finds what changed.
 * 
 * This is the "brain" that figures out:
 * - Did the trader buy something new?
 * - Did they buy MORE of something they had?
 * - Did they sell some of their position?
 * - Did they close a position entirely?
 * 
 * The output is what triggers our copy trades!
 */

import { Position, PositionChange } from '../types';

export class ChangeDetector {
  /** 
   * Minimum change to consider (avoids noise from floating point rounding)
   * Default: 0.01 shares
   */
  private minDelta: number;
  
  constructor(minDelta: number = 0.01) {
    this.minDelta = minDelta;
  }
  
  /**
   * Compare previous and current positions, find all changes
   * 
   * @param previous - Positions from last poll
   * @param current - Positions from this poll  
   * @returns Array of changes detected
   * 
   * @example
   * const changes = detector.detectChanges(oldPositions, newPositions);
   * for (const change of changes) {
   *   console.log(`${change.side} ${change.delta} of ${change.tokenId}`);
   * }
   */
  detectChanges(
    previous: Position[] | ReadonlyMap<string, Position>,
    current: Position[] | ReadonlyMap<string, Position>
  ): PositionChange[] {
    const changes: PositionChange[] = [];
    const now = new Date();

    // Build lookup maps — reuse if input is already a Map, otherwise create fresh
    let prevMap: ReadonlyMap<string, Position>;
    if (previous instanceof Map) {
      prevMap = previous;
    } else {
      const prevArr = previous as Position[];
      prevMap = prevArr.length <= 1 && prevArr.length > 0
        ? new Map([[prevArr[0].tokenId, prevArr[0]]])
        : new Map(prevArr.map(p => [p.tokenId, p]));
    }

    let currMap: ReadonlyMap<string, Position>;
    if (current instanceof Map) {
      currMap = current;
    } else {
      const currArr = current as Position[];
      currMap = currArr.length <= 1 && currArr.length > 0
        ? new Map([[currArr[0].tokenId, currArr[0]]])
        : new Map(currArr.map(p => [p.tokenId, p]));
    }
    
    // === Check CURRENT positions against PREVIOUS ===
    for (const [tokenId, currPos] of currMap) {
      const prevPos = prevMap.get(tokenId);
      
      if (!prevPos) {
        // ✨ NEW POSITION - trader opened a new position
        // This is a BUY (they bought something they didn't have)
        if (currPos.quantity >= this.minDelta) {
          changes.push(this.createChange(
            currPos,
            'BUY',
            currPos.quantity,
            0,
            currPos.quantity,
            now
          ));
        }
      } else {
        // 📊 EXISTING POSITION - check if quantity changed
        const delta = currPos.quantity - prevPos.quantity;
        
        if (Math.abs(delta) >= this.minDelta) {
          // Position size changed
          // Positive delta = BUY (they bought more)
          // Negative delta = SELL (they sold some)
          changes.push(this.createChange(
            currPos,
            delta > 0 ? 'BUY' : 'SELL',
            Math.abs(delta),
            prevPos.quantity,
            currPos.quantity,
            now
          ));
        }
        // If delta is tiny (< minDelta), we ignore it (probably just rounding)
      }
    }
    
    // === Check for CLOSED positions ===
    // These are positions in PREVIOUS but NOT in CURRENT
    for (const [tokenId, prevPos] of prevMap) {
      if (!currMap.has(tokenId)) {
        // 🚪 CLOSED POSITION - trader sold everything
        // This is a SELL of the entire quantity
        if (prevPos.quantity >= this.minDelta) {
          changes.push(this.createChange(
            prevPos,
            'SELL',
            prevPos.quantity,
            prevPos.quantity,
            0,
            now
          ));
        }
      }
    }
    
    return changes;
  }
  
  /**
   * Helper to create a PositionChange object
   */
  private createChange(
    position: Position,
    side: 'BUY' | 'SELL',
    delta: number,
    previousQuantity: number,
    currentQuantity: number,
    detectedAt: Date
  ): PositionChange {
    return {
      tokenId: position.tokenId,
      marketId: position.marketId,
      side,
      delta,
      previousQuantity,
      currentQuantity,
      detectedAt,
      marketTitle: position.marketTitle,
    };
  }
  
  /**
   * Format a change for logging
   */
  static formatChange(change: PositionChange): string {
    const emoji = change.side === 'BUY' ? '🟢' : '🔴';
    const arrow = `${change.previousQuantity.toFixed(2)} → ${change.currentQuantity.toFixed(2)}`;
    const market = change.marketTitle || change.tokenId.slice(0, 20) + '...';
    
    return `${emoji} ${change.side} ${change.delta.toFixed(2)} | ${arrow} | ${market}`;
  }
}
