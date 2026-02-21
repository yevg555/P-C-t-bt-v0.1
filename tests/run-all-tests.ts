/**
 * TEST RUNNER
 * ===========
 * Runs all tests in sequence
 * 
 * Run with: npm test
 */

import { execSync } from 'child_process';
import { join } from 'path';

const tests = [
  { name: 'Copy Size Calculator', file: 'copy-size.test.ts' },
  { name: 'Paper Trading Executor', file: 'paper-executor.test.ts' },
  { name: 'TP/SL Monitor', file: 'tp-sl-monitor.test.ts' },
  { name: 'Market Analyzer', file: 'market-analyzer.test.ts' },
  { name: 'Price Adjuster (Adaptive)', file: 'price-adjuster.test.ts' },
  { name: 'Risk Checker (Market Conditions)', file: 'risk-checker-market.test.ts' },
  { name: 'Copy Size (Depth + Expiration)', file: 'copy-size-depth.test.ts' },
  { name: 'Trade Store (Persistence)', file: 'trade-store.test.ts' },
];

console.log('╔═══════════════════════════════════════════════════╗');
console.log('║           RUNNING ALL TESTS                       ║');
console.log('╚═══════════════════════════════════════════════════╝\n');

let allPassed = true;

for (const test of tests) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Running: ${test.name}`);
  console.log('═'.repeat(50));
  
  try {
    execSync(`npx ts-node tests/${test.file}`, {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
    });
  } catch {
    allPassed = false;
  }
}

console.log('\n' + '═'.repeat(50));

if (allPassed) {
  console.log('✅ ALL TESTS PASSED!');
} else {
  console.log('❌ SOME TESTS FAILED!');
  process.exit(1);
}

console.log('═'.repeat(50) + '\n');
