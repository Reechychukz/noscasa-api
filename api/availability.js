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
    console.log('Fetching new token from Guesty Booking Engine API...');
    
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('scope', 'booking_engine:api');  // Different scope!
    params.append('client_id', process.env.GUESTY_CLIENT_ID);
    params.append('client_secret', process.env.GUESTY_CLIENT_SECRET);
    
    const response = await axios.post(
      'https://booking.guesty.com/oauth2/token',  // Different URL!
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

/**
 * Check if a date range is available by examining the calendar
 */
function areDatesAvailable(calendarData, checkIn, checkOut) {
  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);
  
  // Filter calendar entries for the requested date range
  const relevantDates = calendarData.filter(day => {
    const dayDate = new Date(day.date);
    return dayDate >= checkInDate && dayDate < checkOutDate;
  });
  
  // Check if any day in the range is NOT available
  const hasUnavailable = relevantDates.some(day => 
    day.status !== 'available'
  );
  
  return !hasUnavailable && relevantDates.length > 0;
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
    
    // Call the Booking Engine API calendar endpoint
    const response = await axios.get(
      `https://booking.guesty.com/api/listings/${listing_id}/calendar`,
      {
        params: {
          from: check_in,
          to: check_out
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'accept': 'application/json'
        }
      }
    );
    
    // Check if all dates in the range are available
    const calendarData = response.data;
    const isAvailable = areDatesAvailable(calendarData, check_in, check_out);
    
    // Find the first unavailable date for better error messaging
    let unavailableDate = null;
    if (!isAvailable) {
      const checkInDate = new Date(check_in);
      const checkOutDate = new Date(check_out);
      const unavailableDay = calendarData.find(day => {
        const dayDate = new Date(day.date);
        return dayDate >= checkInDate && dayDate < checkOutDate && day.status !== 'available';
      });
      if (unavailableDay) {
        unavailableDate = unavailableDay.date;
      }
    }
    
    return res.status(200).json({
      success: true,
      available: isAvailable,
      message: isAvailable 
        ? 'These dates are available! You can proceed with booking.'
        : unavailableDate 
          ? `Sorry, these dates are not available. The night of ${unavailableDate} is ${calendarData.find(d => d.date === unavailableDate)?.status}.`
          : 'Sorry, these dates are not available. Please try different dates.',
      listing_id,
      check_in,
      check_out,
      calendar: process.env.NODE_ENV === 'development' ? calendarData : undefined
    });
    
  } catch (error) {
    console.error('Availability check error:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      return res.status(200).json({
        success: true,
        available: true,
        message: 'Authentication issue. Please proceed with booking - we will verify manually.',
        warning: true
      });
    }
    
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
