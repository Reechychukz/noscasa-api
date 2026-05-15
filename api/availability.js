// api/availability.js
// GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD&listingId=xxx
// Returns whether the selected listing is available for the requested date range.

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
        const availableFilter = JSON.stringify({ checkIn: from, checkOut: to, minOccupancy: 1 });
        const listings = await guesty('GET', '/listings', null, {
            ids: effectiveListingId,
            available: availableFilter,
        });

        const available = Array.isArray(listings) && listings.length > 0;
        res.status(200).json({ available, listing: available ? listings[0] : null });
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