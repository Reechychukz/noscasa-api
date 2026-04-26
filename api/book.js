const axios = require('axios');

// In-memory cache (works per function instance on Vercel)
let cachedToken = null;
let tokenExpiry = null;
let lastRequestTime = 0;
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

async function getGuestyToken() {
  // Return cached token if still valid (with 5 min buffer as Guesty recommends)
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
    
    // Set expiration 5 minutes BEFORE actual expiry (as Guesty recommends)
    tokenExpiry = Date.now() + (expires_in - 300) * 1000;
    cachedToken = access_token;
    
    console.log('Token obtained successfully. Expires in', expires_in, 'seconds');
    console.log('Will refresh at', new Date(tokenExpiry));
    return cachedToken;
  } catch (error) {
    console.error('Token error:', error.response?.data || error.message);
    
    // If rate limited and we have an expired token, use it as fallback
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      message: 'Method not allowed' 
    });
  }
  
  try {
    const {
      listing_id,
      guest_name,
      guest_email,
      guest_phone,
      check_in,
      check_out,
      guests,
      notes
    } = req.body;
    
    // Validation - now requiring listing_id
    if (!listing_id || !guest_name || !guest_email || !check_in || !check_out || !guests) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: listing, name, email, check-in, check-out, guests'
      });
    }
    
    // Validate dates
    const checkInDate = new Date(check_in);
    const checkOutDate = new Date(check_out);
    
    if (checkInDate >= checkOutDate) {
      return res.status(400).json({
        success: false,
        message: 'Check-out date must be after check-in date'
      });
    }
    
    if (checkInDate < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Check-in date cannot be in the past'
      });
    }
    
    console.log(`Processing booking for ${guest_name} at listing ${listing_id}`);
    
    // Get OAuth token
    const token = await getGuestyToken();
    
    // Create reservation with dynamic listing_id
    const guestyResponse = await axios.post(
      'https://open-api.guesty.com/v1/reservations',
      {
        listingId: listing_id,
        checkInDateLocalized: check_in,
        checkOutDateLocalized: check_out,
        status: 'confirmed',
        guest: {
          firstName: guest_name.split(' ')[0] || guest_name,
          lastName: guest_name.split(' ').slice(1).join(' ') || 'Guest',
          email: guest_email,
          phone: guest_phone || ''
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    return res.status(200).json({
      success: true,
      message: 'Booking request submitted successfully! Check your email for confirmation.',
      reservationId: guestyResponse.data?.id,
      listingId: listing_id,
      guestName: guest_name,
      checkIn: check_in,
      checkOut: check_out
    });
    
  } catch (error) {
    console.error('Booking error:', error.response?.data || error.message);
    
    if (error.response?.status === 400) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking request. Please check your dates and information.',
        details: error.response?.data
      });
    }
    
    if (error.response?.status === 429) {
      return res.status(200).json({
        success: false,
        message: 'Booking system is busy. Please try again in a few minutes.',
        retryAfter: 60
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Unable to process booking. Please try again or contact us directly.',
      debug: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        details: error.response?.data
      } : undefined
    });
  }
};
