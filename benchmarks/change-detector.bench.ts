
import { ChangeDetector } from '../src/polling/change-detector';
import { Position } from '../src/types';

const ITERATIONS = 10000;

function generatePositions(count: number, prefix: string): Position[] {
  const positions: Position[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      tokenId: `${prefix}-${i}`,
      marketId: `market-${i}`,
      quantity: 100 + Math.random() * 50,
      avgPrice: 0.5,
      curPrice: 0.6,
      marketTitle: `Market ${i}`,
      outcome: 'Yes'
    });
  }
  return positions;
}

function runBenchmark(label: string, size: number) {
  const detector = new ChangeDetector();
  const prevArr = generatePositions(size, 'token');
  const prevMap = new Map(prevArr.map(p => [p.tokenId, p]));

  // modify 10% of positions
  const curr = prevArr.map((p, i) => {
    if (i % 10 === 0) {
      return { ...p, quantity: p.quantity + 10 };
    }
    return p;
  });

  // Test Array vs Array (Old way / non-optimized path)
  let start = process.hrtime();
  for (let i = 0; i < ITERATIONS; i++) {
    detector.detectChanges(prevArr, curr);
  }
  let end = process.hrtime(start);
  let timeMs = (end[0] * 1000 + end[1] / 1e6);
  let ops = ITERATIONS / (timeMs / 1000);

  console.log(`${label} [Array input] (${size} items): ${timeMs.toFixed(2)}ms total, ${ops.toFixed(0)} ops/sec`);

  // Test Map vs Array (New Optimized way)
  start = process.hrtime();
  for (let i = 0; i < ITERATIONS; i++) {
    detector.detectChanges(prevMap, curr);
  }
  end = process.hrtime(start);
  timeMs = (end[0] * 1000 + end[1] / 1e6);
  ops = ITERATIONS / (timeMs / 1000);

  console.log(`${label} [Map input]   (${size} items): ${timeMs.toFixed(2)}ms total, ${ops.toFixed(0)} ops/sec`);
}

console.log('Running ChangeDetector Benchmark...');
runBenchmark('Small', 10);
runBenchmark('Medium', 100);
runBenchmark('Large', 1000);
