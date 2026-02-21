
import { TokenBucket } from "../src/utils/token-bucket";

async function testTokenBucket() {
  console.log("Testing TokenBucket...");

  // Test 1: Immediate Consumption
  {
    console.log("Test 1: Immediate Consumption");
    const bucket = new TokenBucket(10, 10); // 10 tokens, 10/sec = 0.01/ms
    const start = Date.now();
    await bucket.consume(5);
    const end = Date.now();
    if (end - start > 20) {
      console.error(`FAIL: Immediate consumption took too long: ${end - start}ms`);
    } else {
      console.log("PASS: Immediate consumption fast.");
    }
  }

  // Test 2: Refill
  {
    console.log("Test 2: Refill");
    const bucket = new TokenBucket(1, 10); // 1 token, 10/sec = 1 token/100ms
    await bucket.consume(1); // empty
    const start = Date.now();
    await bucket.consume(1); // wait ~100ms
    const end = Date.now();
    const elapsed = end - start;
    if (elapsed >= 90 && elapsed <= 200) { // Allow some buffer for setTimeout variance
      console.log(`PASS: Refill wait time correct (${elapsed}ms).`);
    } else {
      console.error(`FAIL: Refill wait time incorrect: ${elapsed}ms (expected ~100ms)`);
    }
  }

  // Test 3: Burst then Rate Limit
  {
    console.log("Test 3: Burst then Rate Limit");
    const bucket = new TokenBucket(5, 50); // 5 tokens, 50/sec = 1 token/20ms
    const start = Date.now();

    // Consume 5 (burst)
    const burstPromises = [];
    for(let i=0; i<5; i++) burstPromises.push(bucket.consume());
    await Promise.all(burstPromises);

    const mid = Date.now();

    if (mid - start > 20) {
        console.error(`FAIL: Burst took too long: ${mid - start}ms`);
    } else {
        console.log("PASS: Burst allowed.");
    }

    // Next request should wait 20ms
    await bucket.consume();
    const end = Date.now();
    const elapsed = end - mid;

    if (elapsed >= 15) {
        console.log(`PASS: Rate limit enforced (${elapsed}ms).`);
    } else {
        console.error(`FAIL: Rate limit not enforced: ${elapsed}ms`);
    }
  }
}

testTokenBucket().catch(console.error);
