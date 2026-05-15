const { guesty } = require('../lib/guesty');
const { applyCors } = require('../lib/cors');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { listingId, listing_id, fields } = req.query;
    const id = listingId || listing_id;
    if (!id) {
        return res.status(400).json({ error: 'Missing listingId or listing_id query parameter.' });
    }

    try {
        const params = {};
        if (fields) params.fields = fields;

        const result = await guesty('GET', `/listings/${encodeURIComponent(id)}`, null, params);
        res.status(200).json(result);
    } catch (err) {
        const body = err.response?.data || err.message;
        console.error('[listing]', body);
        if (body && typeof body === 'string' && body.includes('TOO_MANY_REQUESTS')) {
            return res.status(429).json({ error: 'Guesty rate limit exceeded. Please try again shortly.' });
        }
        if (body?.error?.code === 'TOO_MANY_REQUESTS') {
            return res.status(429).json({ error: 'Guesty rate limit exceeded. Please try again shortly.' });
        }
        if (err.response?.status === 404) {
            return res.status(404).json({ error: 'Listing not found.' });
        }
        res.status(500).json({ error: 'Failed to fetch listing' });
    }
};