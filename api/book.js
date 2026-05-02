const axios = require('axios');

let cachedToken = null;
let tokenExpiry = null;
let lastRequestTime = 0;
const RATE_LIMIT_DELAY = 1000;

async function getGuestyToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  
  const now = Date.now();
  if (now - lastRequestTime < RATE_LIMIT_DELAY) {
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
  }
  lastRequestTime = Date.now();
  
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  
  try {
    const { listing_id, guest_name, guest_email, guest_phone, check_in, check_out, guests, notes } = req.body;
    
    if (!listing_id || !guest_name || !guest_email || !check_in || !check_out || !guests) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    
    if (new Date(check_in) >= new Date(check_out)) {
      return res.status(400).json({ success: false, message: 'Check-out must be after check-in' });
    }
    
    const token = await getGuestyToken();
    const firstName = guest_name.split(' ')[0] || guest_name;
    const lastName = guest_name.split(' ').slice(1).join(' ') || 'Guest';
    
    const guestyResponse = await axios.post(
      'https://open-api.guesty.com/v1/reservations-v3',
      {
        listingId: listing_id,
        checkInDateLocalized: check_in,
        checkOutDateLocalized: check_out,
        status: 'confirmed',
        guestsCount: parseInt(guests, 10) || 1,
        numberOfGuests: { numberOfAdults: parseInt(guests, 10) || 1, numberOfChildren: 0, numberOfInfants: 0, numberOfPets: 0 },
        guest: { firstName, lastName, email: guest_email, phone: guest_phone || '' },
        applyPromotions: true,
        ignoreCalendar: false,
        ignoreTerms: false,
        ignoreBlocks: false
      },
      { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    
    const reservation = guestyResponse.data;
    return res.status(200).json({
      success: true,
      message: `Booking confirmed! Reservation ID: ${reservation._id || reservation.id}`,
      reservationId: reservation._id || reservation.id
    });
    
  } catch (error) {
    console.error('Booking error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Unable to process booking. Please try again.',
      debug: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
