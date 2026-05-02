const axios = require('axios');

let cachedToken = null;
let tokenExpiry = null;

async function getGuestyToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;
  
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('scope', 'open-api');
  params.append('client_id', process.env.GUESTY_CLIENT_ID);
  params.append('client_secret', process.env.GUESTY_CLIENT_SECRET);
  
  const response = await axios.post('https://open-api.guesty.com/oauth2/token', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  
  tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;
  cachedToken = response.data.access_token;
  return cachedToken;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const { listing_id, check_in, check_out } = req.query;
    if (!listing_id || !check_in || !check_out) {
      return res.status(400).json({ success: false, message: 'Missing parameters' });
    }
    
    const token = await getGuestyToken();
    const availableParam = `{"checkIn":"${check_in}","checkOut":"${check_out}"}`;
    
    const response = await axios.get('https://open-api.guesty.com/v1/listings', {
      params: { ids: listing_id, available: availableParam, active: true },
      paramsSerializer: (params) => Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&'),
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const isAvailable = response.data && response.data.length > 0;
    
    return res.status(200).json({
      success: true,
      available: isAvailable,
      message: isAvailable ? 'Available!' : 'Not available. Try different dates.'
    });
    
  } catch (error) {
    return res.status(200).json({ success: true, available: true, warning: true });
  }
};
