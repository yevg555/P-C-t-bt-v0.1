/**
 * DEBUG: Raw API responses
 * Shows exactly what the API returns
 */

import * as dotenv from 'dotenv';
dotenv.config();

const CLOB_URL = 'https://clob.polymarket.com';

async function main() {
  const traderAddress = process.env.TRADER_ADDRESS;
  if (!traderAddress) {
    console.error('Set TRADER_ADDRESS in .env');
    process.exit(1);
  }
  
  // Get positions first
  console.log('Fetching positions...\n');
  const posResponse = await fetch(`https://data-api.polymarket.com/positions?user=${traderAddress}`);
  const positions = await posResponse.json() as any[];
  
  // Take first 3
  const testPositions = positions.slice(0, 3);
  
  for (const pos of testPositions) {
    const tokenId = pos.asset;
    const title = pos.title || tokenId.slice(0, 30);
    
    console.log('═'.repeat(70));
    console.log(`Market: ${title}`);
    console.log(`Token: ${tokenId}`);
    console.log(`curPrice from positions: ${pos.curPrice}`);
    console.log('');
    
    // Test each endpoint
    
    // 1. /price?side=BUY
    console.log('📡 GET /price?side=BUY');
    try {
      const resp = await fetch(`${CLOB_URL}/price?token_id=${tokenId}&side=BUY`);
      const data = await resp.json();
      console.log(`   Status: ${resp.status}`);
      console.log(`   Response: ${JSON.stringify(data)}`);
    } catch (e) {
      console.log(`   Error: ${e}`);
    }
    
    // 2. /price?side=SELL
    console.log('\n📡 GET /price?side=SELL');
    try {
      const resp = await fetch(`${CLOB_URL}/price?token_id=${tokenId}&side=SELL`);
      const data = await resp.json();
      console.log(`   Status: ${resp.status}`);
      console.log(`   Response: ${JSON.stringify(data)}`);
    } catch (e) {
      console.log(`   Error: ${e}`);
    }
    
    // 3. /midpoint
    console.log('\n📡 GET /midpoint');
    try {
      const resp = await fetch(`${CLOB_URL}/midpoint?token_id=${tokenId}`);
      const data = await resp.json();
      console.log(`   Status: ${resp.status}`);
      console.log(`   Response: ${JSON.stringify(data)}`);
    } catch (e) {
      console.log(`   Error: ${e}`);
    }
    
    // 4. /book (order book)
    console.log('\n📡 GET /book');
    try {
      const resp = await fetch(`${CLOB_URL}/book?token_id=${tokenId}`);
      const data = await resp.json() as any;
      console.log(`   Status: ${resp.status}`);
      console.log(`   Bids: ${data.bids?.length || 0} orders`);
      if (data.bids?.length > 0) {
        console.log(`   Best bid: ${JSON.stringify(data.bids[0])}`);
      }
      console.log(`   Asks: ${data.asks?.length || 0} orders`);
      if (data.asks?.length > 0) {
        console.log(`   Best ask: ${JSON.stringify(data.asks[0])}`);
      }
    } catch (e) {
      console.log(`   Error: ${e}`);
    }
    
    console.log('\n');
  }
}

main().catch(console.error);
