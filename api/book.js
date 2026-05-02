const axios = require('axios');

// In-memory cache for token
let cachedToken = null;
let tokenExpiry = null;
let lastRequestTime = 0;
const RATE_LIMIT_DELAY = 1000;

async function getGuestyToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    console.log('Using cached token, expires in', Math.round((tokenExpiry - Date.now()) / 1000), 'seconds');
    return cachedToken;
  }
  
  const now = Date.now();
  if (now - lastRequestTime < RATE_LIMIT_DELAY) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
  }
  lastRequestTime = Date.now();
  
  try {
    console.log('Fetching new token from Guesty Booking Engine API...');
    
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('scope', 'booking_engine:api');
    params.append('client_id', process.env.GUESTY_CLIENT_ID);
    params.append('client_secret', process.env.GUESTY_CLIENT_SECRET);
    
    const response = await axios.post(
      'https://booking.guesty.com/oauth2/token',
      params,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    
    const { access_token, expires_in } = response.data;
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
    
    const token = await getGuestyToken();
    
    // Parse guest name
    const firstName = guest_name.split(' ')[0] || guest_name;
    const lastName = guest_name.split(' ').slice(1).join(' ') || 'Guest';
    
    // ========== STEP 1: Create a Quote ==========
    console.log(`Step 1: Creating quote for listing ${listing_id}`);
    
    const quotePayload = {
      listingId: listing_id,
      checkInDateLocalized: check_in,
      checkOutDateLocalized: check_out,
      guestsCount: parseInt(guests, 10) || 1,
      numberOfGuests: {
        numberOfAdults: parseInt(guests, 10) || 1,
        numberOfChildren: 0,
        numberOfInfants: 0,
        numberOfPets: 0
      }
    };
    
    const quoteResponse = await axios.post(
      'https://booking.guesty.com/api/reservations/quotes',
      quotePayload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    const quote = quoteResponse.data;
    const quoteId = quote._id;
    
    if (!quoteId) {
      throw new Error('Failed to get quote ID from Guesty');
    }
    
    console.log(`Quote created. ID: ${quoteId}, Expires: ${quote.expiresAt}`);
    
    // Get the first available rate plan from the quote
    const ratePlans = quote.rates?.ratePlans || [];
    if (ratePlans.length === 0) {
      throw new Error('No rate plans available for this quote');
    }
    
    const selectedRatePlan = ratePlans[0];
    const ratePlanId = selectedRatePlan.ratePlan?._id;
    
    if (!ratePlanId) {
      throw new Error('No rate plan ID found in quote');
    }
    
    console.log(`Selected rate plan: ${ratePlanId}`);
    
    // Extract pricing for response
    const pricing = selectedRatePlan.ratePlan?.money || {};
    console.log(`Pricing: ${pricing.currency} ${pricing.fareAccommodation} + cleaning ${pricing.fareCleaning}`);
    
    // ========== STEP 2: Create Reservation from Quote ==========
    console.log(`Step 2: Creating reservation from quote ${quoteId}`);
    
    // Create reservation using the quote
    const reservationPayload = {
      quoteId: quoteId,
      ratePlanId: ratePlanId,
      guest: {
        firstName: firstName,
        lastName: lastName,
        email: guest_email,
        phone: guest_phone || ''
      },
      notes: notes || ''
    };
    
    const reservationResponse = await axios.post(
      'https://booking.guesty.com/api/reservations',
      reservationPayload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );
    
    const reservation = reservationResponse.data;
    
    console.log(`Reservation created successfully. ID: ${reservation._id}`);
    
    // Calculate total price
    const totalPrice = (pricing.fareAccommodation || 0) + (pricing.fareCleaning || 0);
    
    // ========== SUCCESS RESPONSE ==========
    return res.status(200).json({
      success: true,
      message: `Booking confirmed! Your reservation ID is ${reservation._id}. A confirmation email has been sent.`,
      reservationId: reservation._id,
      quoteId: quoteId,
      guestName: guest_name,
      checkIn: check_in,
      checkOut: check_out,
      price: {
        accommodation: pricing.fareAccommodation,
        cleaning: pricing.fareCleaning,
        currency: pricing.currency || 'USD',
        total: totalPrice
      }
    });
    
  } catch (error) {
    console.error('Booking process error:', error.response?.data || error.message);
    
    // Handle specific errors
    if (error.response?.status === 400) {
      const errorCode = error.response?.data?.error?.code;
      if (errorCode === 'RATE_PLAN_NOT_FOUND') {
        return res.status(400).json({
          success: false,
          message: 'This property is not configured for online booking. Please contact us directly.'
        });
      }
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
