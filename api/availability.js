// api/availability.js
// GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns blocked dates so the widget can disable them in the date pickers.

const { guesty } = require('../lib/guesty');
const { cors } = require('../lib/cors');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Missing params: from, to' });

  try {
    const data = await guesty('GET', `/listings/${process.env.GUESTY_LISTING_ID}/calendar`, null, { from, to });

    const days = (data.days || []).map(d => ({
      date: d.date,
      available: d.status === 'available',
      minNights: d.minNights || 1,
    }));

    res.status(200).json({ days });
  } catch (err) {
    console.error('[availability]', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
};