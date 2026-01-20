/**
 * FIND ACTIVE MARKETS
 * ====================
 * Scans trader's positions to find markets that are:
 * 1. Still active (not resolved)
 * 2. Have liquidity (prices between 0.05 and 0.95)
 * 3. Have valid order book
 * 
 * Run with: npx ts-node scripts/find-active.ts
 */

import * as dotenv from 'dotenv';
import { PolymarketAPI } from '../src/api/polymarket-api';

dotenv.config();

async function main() {
  console.log('🔍 Finding Active Markets\n');
  
  const api = new PolymarketAPI();
  const traderAddress = process.env.TRADER_ADDRESS;
  
  if (!traderAddress) {
    console.error('❌ Set TRADER_ADDRESS in .env');
    process.exit(1);
  }
  
  console.log('Fetching positions...');
  const positions = await api.getPositions(traderAddress);
  console.log(`Found ${positions.length} positions\n`);
  
  console.log('Checking each market for activity...\n');
  
  const activeMarkets: Array<{
    title: string;
    tokenId: string;
    curPrice: number;
    buyPrice: number;
    sellPrice: number;
    spread: number;
    outcome?: string;
  }> = [];
  
  const resolvedMarkets: string[] = [];
  const errorMarkets: string[] = [];
  
  for (const pos of positions) {
    const title = pos.marketTitle || pos.tokenId.slice(0, 30) + '...';
    const curPrice = pos.curPrice || 0;
    
    // Skip obviously resolved markets (curPrice near 0 or 1)
    if (curPrice < 0.02 || curPrice > 0.98) {
      resolvedMarkets.push(`${title} (curPrice: ${curPrice.toFixed(4)})`);
      continue;
    }
    
    try {
      const buyPrice = await api.getPrice(pos.tokenId, 'BUY');
      const sellPrice = await api.getPrice(pos.tokenId, 'SELL');
      
      // Check if prices are valid
      if (buyPrice <= 0 || buyPrice >= 1 || sellPrice <= 0 || sellPrice >= 1) {
        resolvedMarkets.push(`${title} (no liquidity)`);
        continue;
      }
      
      const spread = buyPrice - sellPrice;
      
      activeMarkets.push({
        title,
        tokenId: pos.tokenId,
        curPrice,
        buyPrice,
        sellPrice,
        spread,
        outcome: pos.outcome,
      });
      
    } catch (error) {
      errorMarkets.push(`${title} (${error})`);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  // Print results
  console.log('═'.repeat(70));
  console.log(`✅ ACTIVE MARKETS (${activeMarkets.length})`);
  console.log('═'.repeat(70));
  
  if (activeMarkets.length === 0) {
    console.log('\nNo active markets found!');
    console.log('This trader may only hold resolved positions.\n');
  } else {
    console.log('');
    for (const m of activeMarkets) {
      console.log(`📊 ${m.title}`);
      console.log(`   Outcome:    ${m.outcome || 'N/A'}`);
      console.log(`   curPrice:   $${m.curPrice.toFixed(4)} (${(m.curPrice * 100).toFixed(1)}%)`);
      console.log(`   BUY at:     $${m.buyPrice.toFixed(4)}`);
      console.log(`   SELL at:    $${m.sellPrice.toFixed(4)}`);
      console.log(`   Spread:     $${m.spread.toFixed(4)} (${(m.spread / m.sellPrice * 100).toFixed(2)}%)`);
      console.log(`   Token:      ${m.tokenId.slice(0, 50)}...`);
      console.log('');
    }
  }
  
  console.log('═'.repeat(70));
  console.log(`⏹️  RESOLVED/NO LIQUIDITY (${resolvedMarkets.length})`);
  console.log('═'.repeat(70));
  for (const m of resolvedMarkets.slice(0, 10)) {
    console.log(`   • ${m}`);
  }
  if (resolvedMarkets.length > 10) {
    console.log(`   ... and ${resolvedMarkets.length - 10} more`);
  }
  
  if (errorMarkets.length > 0) {
    console.log('\n═'.repeat(70));
    console.log(`❌ ERRORS (${errorMarkets.length})`);
    console.log('═'.repeat(70));
    for (const m of errorMarkets.slice(0, 5)) {
      console.log(`   • ${m}`);
    }
  }
  
  console.log('\n✅ Scan complete!');
  
  // Summary
  console.log('\n📊 Summary:');
  console.log(`   Active:   ${activeMarkets.length}`);
  console.log(`   Resolved: ${resolvedMarkets.length}`);
  console.log(`   Errors:   ${errorMarkets.length}`);
}

main().catch(console.error);
