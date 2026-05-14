// api/pricing.js
// GET /api/pricing?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&guests=N
// Returns a full price breakdown for the selected stay from Guesty.

const { guesty } = require('../lib/guesty');
const { cors } = require('../lib/cors');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { checkIn, checkOut, guests } = req.query;
  if (!checkIn || !checkOut) return res.status(400).json({ error: 'Missing params: checkIn, checkOut' });

  try {
    const data = await guesty('GET', `/listings/${process.env.GUESTY_LISTING_ID}/quote`, null, {
      checkInDateLocalized: checkIn,
      checkOutDateLocalized: checkOut,
      guestsCount: guests || 2,
    });

    const money = data.invoice || {};

    res.status(200).json({
      nights: money.nightsCount || 0,
      fareAccommodation: money.fareAccommodation || 0,
      fareCleaning: money.fareCleaning || 0,
      cityTax: money.fareCityTax || 0,
      totalPrice: money.totalPrice || 0,
      currency: money.currency || 'EUR',
    });
  } catch (err) {
    console.error('[pricing]', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch pricing' });
  }
};