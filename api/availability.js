const axios = require('axios');
const qs = require('qs');

let cachedToken = null;
let tokenExpiry = null;

async function getGuestyToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    return cachedToken;
  }
  
  const response = await axios.post(
    'https://open-api.guesty.com/oauth2/token',
    new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'open-api',
      client_id: process.env.GUESTY_CLIENT_ID,
      client_secret: process.env.GUESTY_CLIENT_SECRET
    }),
    {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  
  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in * 1000);
  return cachedToken;
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
    
    // Build the available parameter as a JSON string with curly braces
    const availableParam = JSON.stringify({
      checkIn: check_in,
      checkOut: check_out
    });
    
    console.log(`Checking availability for listing ${listing_id} from ${check_in} to ${check_out}`);
    console.log(`Available param: ${availableParam}`);
    
    // Call Guesty API with the available parameter
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
          // Use qs to properly serialize the available parameter
          return qs.stringify(params, { encode: false, allowDots: false });
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    // If the listing is in the response array, it's available
    const isAvailable = response.data && response.data.length > 0;
    
    console.log(`Availability result: ${isAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
    
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
    
    // Return a safe fallback - assume available but warn
    return res.status(200).json({
      success: true,
      available: true,
      message: 'Unable to verify availability. Please proceed with booking.',
      warning: true
    });
  }
};
