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
        const response = await guesty('GET', '/listings', null, {
            ids: effectiveListingId,
            available: availableFilter,
        });

        const available = response?.results?.length > 0;
        const listing = response?.results?.[0] || null;

        return res.status(200).json({ available, listing: available ? listing : null });
    } catch (err) {
        if (err.response?.status === 404) {
            console.warn('[availability] availability filter unsupported, falling back to listing lookup by ids');
            try {
                const response = await guesty('GET', '/listings', null, { ids: effectiveListingId });
                const listing = response?.results?.[0];
                if (!listing) {
                    return res.status(404).json({ error: 'Listing not found' });
                }

                const available = typeof listing?.isAvailable === 'boolean'
                    ? listing.isAvailable
                    : typeof listing?.available === 'boolean'
                        ? listing.available
                        : typeof listing?.active === 'boolean'
                            ? listing.active
                            : listing.isListed !== false;

                return res.status(200).json({
                    available: available !== false,
                    listing,
                    fallback: true,
                    note: 'Availability query is not supported by this Guesty tenant; using listing details instead.',
                });
            } catch (fallbackError) {
                console.error('[availability-fallback]', fallbackError.response?.data || fallbackError.message);
                return res.status(500).json({ error: 'Failed to fetch listing fallback availability' });
            }
        }

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