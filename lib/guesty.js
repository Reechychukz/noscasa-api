// lib/guesty.js
const axios = require('axios');
const { createClient } = require('redis');

let _token = null;
let _tokenExpiry = 0;
let _redisClient = null;
const IN_MEMORY_CACHE = new Map();
const CACHE_TTL_MS = Number(process.env.GUESTY_CACHE_TTL_SECONDS || '30') * 1000;
const STALE_WINDOW_MS = Number(process.env.GUESTY_CACHE_STALE_SECONDS || '300') * 1000;
const MAX_RETRY_ATTEMPTS = Number(process.env.GUESTY_RETRY_MAX_ATTEMPTS || '4');
const RETRY_BASE_MS = Number(process.env.GUESTY_RETRY_BASE_MS || '1000');
const RETRY_MAX_MS = Number(process.env.GUESTY_RETRY_MAX_MS || '30000');
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

async function getRedisClient() {
    if (_redisClient) return _redisClient;
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return null;

    _redisClient = createClient({ url: redisUrl });
    _redisClient.on('error', err => console.error('Redis error:', err));
    try {
        await _redisClient.connect();
    } catch (err) {
        console.error('Redis connection failed:', err);
        _redisClient = null;
    }
    return _redisClient;
}

async function getCachedValue(key) {
    const client = await getRedisClient();
    if (client) {
        try {
            const raw = await client.get(key);
            if (raw) return JSON.parse(raw);
        } catch (err) {
            console.error('Redis get failed:', err);
        }
    }
    return IN_MEMORY_CACHE.get(key) || null;
}

async function setCachedValue(key, value) {
    const payload = JSON.stringify({ createdAt: Date.now(), value });
    IN_MEMORY_CACHE.set(key, { createdAt: Date.now(), value });

    const client = await getRedisClient();
    if (!client) return;

    try {
        await client.setEx(key, Math.ceil((CACHE_TTL_MS + STALE_WINDOW_MS) / 1000), payload);
    } catch (err) {
        console.error('Redis set failed:', err);
    }
}

function getCacheKey(method, path, params) {
    return `${method}:${new URL(path, 'https://open-api.guesty.com/v1').toString()}:${JSON.stringify(params || {})}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRetryDelay(attempt, retryAfterHeader) {
  if (retryAfterHeader) {
    const parsed = parseInt(retryAfterHeader, 10);
    if (!Number.isNaN(parsed)) {
      return Math.min(parsed * 1000, 60000);
    }
  }

  const expo = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  return Math.random() * expo;
}

function shouldRetry(method, status) {
  return method === 'GET' && RETRYABLE_STATUSES.has(status);
}

async function guesty(method, path, data = null, params = {}) {
  const token = await getToken();
  const methodUpper = method.toUpperCase();
  const cacheKey = methodUpper === 'GET' ? getCacheKey(methodUpper, path, params) : null;

  let staleCache = null;
  if (cacheKey) {
    const cached = await getCachedValue(cacheKey);
    if (cached) {
      const age = Date.now() - cached.createdAt;
      if (age <= CACHE_TTL_MS) {
        return cached.value;
      }
      if (age <= CACHE_TTL_MS + STALE_WINDOW_MS) {
        staleCache = cached;
      }
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await axios({
        method: methodUpper,
        url: new URL(path, 'https://open-api.guesty.com/v1').toString(),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        params,
        data,
        responseType: 'text',
        validateStatus: () => true,
      });
    } catch (err) {
      console.error('Guesty request failed:', err.message || err);
      lastError = err;
      if (staleCache) {
        console.warn('Using stale Guesty cache after request failure');
        return staleCache.value;
      }
      if (attempt === MAX_RETRY_ATTEMPTS || methodUpper !== 'GET') {
        throw err;
      }
      const delay = getRetryDelay(attempt);
      console.warn(`Retrying Guesty request in ${Math.round(delay)}ms (attempt ${attempt + 1})`);
      await sleep(delay);
      continue;
    }

    console.log('Guesty response for', methodUpper, path, 'status', res.status, 'body:', res.data);

    if (res.status < 200 || res.status >= 300) {
      const retryAfter = res.headers?.['retry-after'];
      const error = new Error(`Guesty API returned status ${res.status}: ${res.data}`);
      lastError = error;

      if (staleCache) {
        console.warn('Using stale Guesty cache due to API error/status', res.status);
        return staleCache.value;
      }

      if (attempt === MAX_RETRY_ATTEMPTS || !shouldRetry(methodUpper, res.status)) {
        throw error;
      }

      const delay = getRetryDelay(attempt, retryAfter);
      console.warn(`Retrying Guesty request in ${Math.round(delay)}ms due to status ${res.status} (attempt ${attempt + 1})`);
      await sleep(delay);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(res.data);
    } catch (e) {
      console.error('Failed to parse JSON from Guesty API:', res.data);
      if (staleCache) {
        console.warn('Using stale Guesty cache after invalid JSON response');
        return staleCache.value;
      }
      throw new Error('Invalid JSON response from Guesty API');
    }

    if (cacheKey) {
      await setCachedValue(cacheKey, parsed);
    }

    return parsed;
  }

  if (staleCache) {
    return staleCache.value;
  }

  throw lastError || new Error('Guesty request failed');
}

async function getToken() {
  const now = Date.now();
  if (_token && now < _tokenExpiry) {
    console.log('Returning in-memory token, expires in', Math.round((_tokenExpiry - now) / 1000), 'seconds');
    return _token;
  }

  // Check Redis cache first
  const client = await getRedisClient();
  if (client) {
    try {
      console.log('Checking Redis for cached token...');
      const cached = await client.get('guesty_token');
      if (cached) {
        const { token, expiry } = JSON.parse(cached);
        const timeLeft = expiry - now;
        if (timeLeft > 0) {
          console.log('✅ Found valid token in Redis, expires in', Math.round(timeLeft / 1000), 'seconds');
          _token = token;
          _tokenExpiry = expiry;
          return _token;
        } else {
          console.log('Token in Redis expired, will generate new one');
        }
      } else {
        console.log('No token found in Redis, will generate new one');
      }
    } catch (err) {
      console.error('Redis token get failed:', err.message);
    }
  } else {
    console.warn('⚠️  Redis client not available, token will not be cached');
  }

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await axios.post(
        'https://open-api.guesty.com/oauth2/token',
        new URLSearchParams({
          grant_type: 'client_credentials',
          scope: 'open-api',
          client_id: process.env.GUESTY_CLIENT_ID,
          client_secret: process.env.GUESTY_CLIENT_SECRET,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      _token = res.data.access_token;
      _tokenExpiry = now + (res.data.expires_in - 300) * 1000;

      // Cache in Redis
      if (client) {
        try {
          await client.setEx('guesty_token', Math.ceil((res.data.expires_in - 300) / 1), JSON.stringify({ token: _token, expiry: _tokenExpiry }));
        } catch (err) {
          console.error('Redis token set failed:', err);
        }
      }

      return _token;
    } catch (err) {
      const status = err.response?.status;
      lastError = err;

      if (attempt === MAX_RETRY_ATTEMPTS || !RETRYABLE_STATUSES.has(status)) {
        throw err;
      }

      const delay = getRetryDelay(attempt, err.response?.headers?.['retry-after']);
      console.warn(`Retrying Guesty token request in ${Math.round(delay)}ms due to status ${status} (attempt ${attempt + 1})`);
      await sleep(delay);
    }
  }

  throw lastError || new Error('Token request failed');
}

module.exports = { guesty };
