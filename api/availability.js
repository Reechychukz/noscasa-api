// api/availability.js
// GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD&listingId=xxx
// Returns blocked dates so the widget can disable them in the date pickers.

const { guesty } = require('../lib/guesty');
const { cors } = require('../lib/cors');
const { validateAvailabilityQuery } = require('../lib/booking-validation');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const validation = validateAvailabilityQuery(req.query);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const { listingId: effectiveListingId, from, to } = validation;

  try {
    const data = await guesty('GET', `/listings/${effectiveListingId}/calendar`, null, { from, to });

    const days = (data.days || []).map(d => ({
      date: d.date,
      available: d.status === 'available',
      minNights: d.minNights || 1,
    }));

    res.status(200).json({ days });
  } catch (err) {
    const body = err.response?.data || err.message;
    console.error('[availability]', body);
    if (body && typeof body === 'string' && body.includes('TOO_MANY_REQUESTS')) {
      return res.status(429).json({ error: 'Guesty rate limit exceeded. Please try again shortly.' });
    }
    if (body?.error?.code === 'TOO_MANY_REQUESTS') {
      return res.status(429).json({ error: 'Guesty rate limit exceeded. Please try again shortly.' });
    }
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
};