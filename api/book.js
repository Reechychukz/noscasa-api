const axios = require('axios');

let cachedToken = null;
let tokenExpiry = null;

async function getGuestyToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 5 * 60 * 1000) {
    console.log('Using cached token');
    return cachedToken;
  }
  
  try {
    console.log('Fetching new token from Guesty Open API...');
    
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
    console.log('Token obtained successfully');
    return cachedToken;
  } catch (error) {
    console.error('Token error:', error.response?.data || error.message);
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
      listing_id,        // <-- NEW: Accept listing ID from form
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
        listingId: listing_id,  // <-- USING THE LISTING ID FROM THE FORM
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
