const axios = require('axios');

// In-memory cache (works per function instance on Vercel)
let cachedToken = null;
let tokenExpiry = null;
let lastRequestTime = 0;
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

async function getGuestyToken() {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    console.log('Using cached token, expires in', Math.round((tokenExpiry - Date.now()) / 1000), 'seconds');
    return cachedToken;
  }
  
  // Rate limiting: Don't request more than once per second
  const now = Date.now();
  if (now - lastRequestTime < RATE_LIMIT_DELAY) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
  }
  lastRequestTime = Date.now();
  
  try {
    console.log('Fetching new token from Guesty Open API...');
    
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('scope', 'open-api');
    params.append('client_id', process.env.GUESTY_CLIENT_ID);
    params.append('client_secret', process.env.GUESTY_CLIENT_SECRET);
    
    const response = await axios.post(
      'https://open-api.guesty.com/oauth2/token',
      params,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    
    const { access_token, expires_in } = response.data;
    
    // Set expiration 5 minutes BEFORE actual expiry
    tokenExpiry = Date.now() + (expires_in - 300) * 1000;
    cachedToken = access_token;
    
    console.log('Token obtained successfully. Expires in', expires_in, 'seconds');
    return cachedToken;
  } catch (error) {
    console.error('Token error:', error.response?.data || error.message);
    
    if (error.response?.status === 429 && cachedToken) {
      console.log('Rate limited, using cached token as fallback');
      return cachedToken;
    }
    
    throw new Error('Failed to authenticate with Guesty');
  }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  
  try {
    const { listing_id, check_in, check_out } = req.query;
    
    if (!listing_id || !check_in || !check_out) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: listing_id, check_in, check_out'
      });
    }
    
    const token = await getGuestyToken();
    
    // Use the format Guesty's example shows
    const response = await axios.get('https://open-api.guesty.com/v1/listings', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'accept': 'application/json; charset=utf-8'
      },
      params: {
        ids: listing_id,
        active: true,
        'pms.active': true,
        listed: true,
        'available.checkIn': check_in,
        'available.checkOut': check_out,
        ignoreFlexibleBlocks: false,
      }
    });
    
    const isAvailable = response.data && response.data.length > 0;
    
    return res.status(200).json({
      success: true,
      available: isAvailable,
      message: isAvailable 
        ? 'These dates are available! You can proceed with booking.'
        : 'Sorry, these dates are not available. Please try different dates.',
      listing_id,
      check_in,
      check_out
    });
    
  } catch (error) {
    console.error('Availability check error:', error.response?.data || error.message);
    
    if (error.response?.status === 429) {
      return res.status(200).json({
        success: true,
        available: true,
        message: 'Availability check is busy. Please proceed with booking - we will verify manually.',
        warning: true,
        rateLimited: true
      });
    }
    
    return res.status(200).json({
      success: true,
      available: true,
      message: 'Unable to verify availability. Please proceed with booking.',
      warning: true
    });
  }
};
