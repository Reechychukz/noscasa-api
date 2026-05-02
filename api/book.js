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
    
    // Validation
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
    
    // Parse guest name
    const firstName = guest_name.split(' ')[0] || guest_name;
    const lastName = guest_name.split(' ').slice(1).join(' ') || 'Guest';
    
    // Create reservation using Open API v3 endpoint
    const guestyResponse = await axios.post(
      'https://open-api.guesty.com/v1/reservations-v3',
      {
        listingId: listing_id,
        checkInDateLocalized: check_in,
        checkOutDateLocalized: check_out,
        status: 'confirmed',
        guestsCount: parseInt(guests, 10) || 1,
        numberOfGuests: {
          numberOfAdults: parseInt(guests, 10) || 1,
          numberOfChildren: 0,
          numberOfInfants: 0,
          numberOfPets: 0
        },
        guest: {
          firstName: firstName,
          lastName: lastName,
          email: guest_email,
          phone: guest_phone || ''
        },
        source: 'webflow',  // <-- ADDED: This is the required field
        applyPromotions: true,
        ignoreCalendar: false,
        ignoreTerms: false,
        ignoreBlocks: false
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    const reservation = guestyResponse.data;
    
    return res.status(200).json({
      success: true,
      message: `Booking confirmed! Your reservation ID is ${reservation._id || reservation.id}. A confirmation email has been sent.`,
      reservationId: reservation._id || reservation.id,
      listingId: listing_id,
      guestName: guest_name,
      checkIn: check_in,
      checkOut: check_out
    });
    
  } catch (error) {
    console.error('Booking error:', error.response?.data || error.message);
    
    if (error.response?.status === 400 || error.response?.status === 422) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking request. Please check your dates and information.',
        details: error.response?.data
      });
    }
    
    if (error.response?.status === 401 || error.response?.status === 403) {
      return res.status(500).json({
        success: false,
        message: 'Booking system configuration error. Please contact support.'
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
