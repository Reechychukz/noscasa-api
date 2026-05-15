// api/pricing.js
// GET /api/pricing?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&guests=N&listingId=xxx
// Returns a full price breakdown for the selected stay from Guesty.

const { guesty } = require('../lib/guesty');
const { applyCors } = require('../lib/cors');
const { validatePricingQuery } = require('../lib/booking-validation');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const validation = validatePricingQuery(req.query);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
    }

    const { listingId: effectiveListingId, checkIn, checkOut, nights } = validation;

    try {
        // Get listing details for pricing and fees.
        const response = await guesty('GET', '/listings', null, { ids: effectiveListingId });
        const listing = response?.results?.[0];
        if (!listing) {
            return res.status(404).json({ error: 'Listing not found' });
        }

        const prices = listing.prices || {};
        const basePrice = Number(prices.basePrice || 0);
        const fareAccommodation = basePrice * nights;
        const fareCleaning = Number(prices.cleaningFee || 0);
        const currency = prices.currency || 'EUR';

        const totalPrice = fareAccommodation + fareCleaning;

        res.status(200).json({
            nights,
            fareAccommodation,
            fareCleaning,
            cityTax: 0, // Add if you have city tax logic
            totalPrice,
            currency,
        });
    } catch (err) {
        const body = err.response?.data || err.message;
        console.error('[pricing]', body);
        if (body && typeof body === 'string' && body.includes('TOO_MANY_REQUESTS')) {
            return res.status(429).json({ error: 'Guesty rate limit exceeded. Please try again shortly.' });
        }
        if (body?.error?.code === 'TOO_MANY_REQUESTS') {
            return res.status(429).json({ error: 'Guesty rate limit exceeded. Please try again shortly.' });
        }
        res.status(500).json({ error: 'Failed to fetch pricing' });
    }
};