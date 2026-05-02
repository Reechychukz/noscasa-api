const axios = require('axios');

let cachedToken = null;
let tokenExpiry = null;
let lastRequestTime = 0;
const RATE_LIMIT_DELAY = 1000;

async function getGuestyToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    console.log('Using cached token');
    return cachedToken;
  }
  
  const now = Date.now();
  if (now - lastRequestTime < RATE_LIMIT_DELAY) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
  }
  lastRequestTime = Date.now();
  
  try {
    console.log('Fetching new token from Guesty Open API...');
    
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('scope', 'open-api');  // NOT booking_engine:api
    params.append('client_id', process.env.GUESTY_CLIENT_ID);
    params.append('client_secret', process.env.GUESTY_CLIENT_SECRET);
    
    const response = await axios.post(
      'https://open-api.guesty.com/oauth2/token',  // NOT booking.guesty.com
      params,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    
    const { access_token, expires_in } = response.data;
    tokenExpiry = Date.now() + (expires_in - 300) * 1000;
    cachedToken = access_token;
    
    console.log('Token obtained successfully');
    return cachedToken;
  } catch (error) {
    console.error('Token error:', error.response?.data || error.message);
    if (error.response?.status === 429 && cachedToken) return cachedToken;
    throw new Error('Failed to authenticate with Guesty');
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
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
    
    // Open API format for availability
    const availableParam = `{"checkIn":"${check_in}","checkOut":"${check_out}"}`;
    
    const response = await axios.get(
      'https://open-api.guesty.com/v1/listings',
      {
        params: {
          ids: listing_id,
          available: availableParam,
          active: true,
          limit: 10
        },
        paramsSerializer: (params) => {
          return Object.keys(params)
            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
            .join('&');
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    // If the listing is in the response array, it's available
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
    
    // Fallback - assume available so booking can proceed
    return res.status(200).json({
      success: true,
      available: true,
      message: 'Unable to verify availability. Please proceed with booking.',
      warning: true
    });
  }
};
