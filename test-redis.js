#!/usr/bin/env node
/**
 * Test Redis connection and verify token caching
 * Run: node test-redis.js
 */

const { createClient } = require('redis');

async function testRedis() {
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.error('❌ REDIS_URL not set in .env');
    process.exit(1);
  }

  console.log('🔍 Testing Redis connection...');
  console.log('📍 URL:', redisUrl.replace(/:[^@]*@/, ':***@')); // Hide password

  const client = createClient({ url: redisUrl });
  
  client.on('error', err => {
    console.error('❌ Redis error:', err.message);
  });

  try {
    console.log('⏳ Connecting to Redis...');
    await client.connect();
    console.log('✅ Connected to Redis!');

    // Test write
    console.log('\n📝 Testing write...');
    await client.set('test_key', JSON.stringify({ message: 'hello' }));
    console.log('✅ Write successful');

    // Test read
    console.log('\n📖 Testing read...');
    const value = await client.get('test_key');
    console.log('✅ Read successful:', value);

    // Check for guesty_token
    console.log('\n🔑 Checking for guesty_token in Redis...');
    const token = await client.get('guesty_token');
    if (token) {
      const parsed = JSON.parse(token);
      const expiryDate = new Date(parsed.expiry);
      console.log('✅ Token found in Redis!');
      console.log('   Expires at:', expiryDate.toISOString());
      console.log('   Time left:', Math.round((parsed.expiry - Date.now()) / 1000), 'seconds');
    } else {
      console.log('ℹ️  No token in Redis yet (will be cached on first API call)');
    }

    // Cleanup
    await client.del('test_key');
    console.log('\n✅ All tests passed!');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await client.quit();
  }
}

testRedis();
