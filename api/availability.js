const axios = require('axios');
const { get, set } = require('@vercel/edge-config');

async function getGuestyToken() {
  // Try to get cached token from Edge Config
  const cached = await get('guesty_token');
  if (cached && cached.expiresAt && Date.now() < cached.expiresAt) {
    console.log('Using cached token from Edge Config');
    return cached.token;
  }
  
  // Request new token
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('scope', 'open-api');
  params.append('client_id', process.env.GUESTY_CLIENT_ID);
  params.append('client_secret', process.env.GUESTY_CLIENT_SECRET);
  
  const response = await axios.post('https://open-api.guesty.com/oauth2/token', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  
  const tokenData = {
    token: response.data.access_token,
    expiresAt: Date.now() + (response.data.expires_in - 300) * 1000
  };
  
  // Store in Edge Config
  await set('guesty_token', tokenData);
  
  return tokenData.token;
}


module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const { listing_id, check_in, check_out } = req.query;
    if (!listing_id || !check_in || !check_out) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing parameters' 
      });
    }
    
    const token = await getGuestyToken();
    const availableParam = `{"checkIn":"${check_in}","checkOut":"${check_out}"}`;
    
    const response = await axios.get('https://open-api.guesty.com/v1/listings', {
      params: { ids: listing_id, available: availableParam, active: true },
      paramsSerializer: (params) => Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&'),
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const isAvailable = response.data && response.data.length > 0;
    
    // Return success with proper message
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
    console.error('Availability error:', error.response?.data || error.message);
    
    // Warning fallback - only reached if the API call fails
    return res.status(200).json({
      success: true,
      available: true,
      message: 'Availability check is currently limited. Please proceed with booking - we will verify manually.',
      warning: true
    });
  }
};
