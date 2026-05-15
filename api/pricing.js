// api/pricing.js
// GET /api/pricing?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&guests=N&listingId=xxx
// Returns a full price breakdown for the selected stay from Guesty.

const { guestyClient } = require('../lib/guesty');
const { applyCors } = require('../lib/cors');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { checkIn, checkOut, guests, listingId, listing_id } = req.query;
    const effectiveListingId = listingId || listing_id;

    if (!checkIn || !checkOut || !effectiveListingId) {
        return res.status(400).json({ error: 'Missing required params: checkIn, checkOut, listingId/listing_id' });
    }

    try {
        const guesty = guestyClient();

        // Get calendar data for pricing per night
        const calendarRes = await guesty.get(`/listings/${effectiveListingId}/calendar`, {
            from: checkIn,
            to: checkOut,
        });

        // Get listing details for base prices (cleaning fee, etc.)
        const listingRes = await guesty.get(`/listings/${effectiveListingId}`);

        const days = calendarRes.data.days || [];
        const listing = listingRes.data;
        const prices = listing.prices || {};

        // Calculate accommodation total from calendar prices
        let fareAccommodation = 0;
        let nights = 0;

        for (const day of days) {
            if (day.status === 'available' && day.price) {
                fareAccommodation += day.price;
                nights++;
            }
        }

        // Get other fees from listing
        const fareCleaning = prices.cleaningFee || 0;
        const currency = prices.currency || 'EUR';

        // Calculate total (you may need to add taxes, etc. based on your business logic)
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
        console.error('[pricing]', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to fetch pricing' });
    }
};