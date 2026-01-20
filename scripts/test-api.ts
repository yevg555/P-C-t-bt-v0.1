/**
 * TEST API CONNECTION
 * ===================
 * Quick test to verify we can connect to Polymarket API
 * 
 * Run with: npm run test:api
 */

import * as dotenv from 'dotenv';
import { PolymarketAPI } from '../src/api/polymarket-api';

dotenv.config();

async function testApi() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   POLYMARKET API TEST                             ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');
  
  const api = new PolymarketAPI();
  
  // Use trader from .env or a known active one
  const traderAddress = process.env.TRADER_ADDRESS;
  
  if (!traderAddress || traderAddress.startsWith('0x00000')) {
    console.log('⚠️  No TRADER_ADDRESS set in .env');
    console.log('   Using a sample trader for testing...\n');
    
    // You can replace this with any known Polymarket trader
    // Find them at: https://polymarket.com/leaderboard
    console.log('   Tip: Set TRADER_ADDRESS in .env to track a specific trader\n');
  }
  
  const addressToTest = traderAddress && !traderAddress.startsWith('0x00000') 
    ? traderAddress 
    : '0x0000000000000000000000000000000000000000'; // Will likely return empty
  
  console.log(`🔍 Testing API with address: ${addressToTest.slice(0, 20)}...`);
  console.log('');
  
  try {
    const startTime = Date.now();
    const positions = await api.getPositions(addressToTest);
    const duration = Date.now() - startTime;
    
    console.log('✅ API Connection Successful!');
    console.log(`   Response time: ${duration}ms`);
    console.log(`   Positions found: ${positions.length}`);
    console.log('');
    
    if (positions.length > 0) {
      console.log('📊 Sample Positions:');
      console.log('─'.repeat(50));
      
      const samples = positions.slice(0, 5);
      for (const pos of samples) {
        const title = pos.marketTitle || pos.tokenId.slice(0, 30) + '...';
        console.log(`   ${pos.quantity.toFixed(2)} shares @ $${pos.avgPrice.toFixed(3)}`);
        console.log(`   ${title}`);
        console.log('');
      }
      
      if (positions.length > 5) {
        console.log(`   ... and ${positions.length - 5} more positions`);
      }
    } else {
      console.log('📭 No positions found for this address.');
      console.log('   This could mean:');
      console.log('   1. The address has no open positions');
      console.log('   2. The address is not a valid Polymarket wallet');
      console.log('   3. You need to set a real TRADER_ADDRESS in .env');
    }
    
  } catch (error) {
    console.error('❌ API Test Failed!');
    console.error('');
    
    if (error instanceof Error) {
      const errType = error.message.split(':')[0];
      console.error(`   Error Type: ${errType}`);
      console.error(`   Message: ${error.message}`);
      
      if (error.message.includes('NETWORK_ERROR')) {
        console.log('\n   💡 Possible causes:');
        console.log('      - No internet connection');
        console.log('      - Polymarket API is down');
        console.log('      - Firewall blocking the request');
      }
      
      if (error.message.includes('RATE_LIMITED')) {
        console.log('\n   💡 You are being rate limited.');
        console.log('      Wait a few seconds and try again.');
      }
    } else {
      console.error('   Unknown error:', error);
    }
    
    process.exit(1);
  }
  
  console.log('\n' + '─'.repeat(50));
  console.log('🎉 API test complete!');
  console.log('─'.repeat(50) + '\n');
}

testApi();
