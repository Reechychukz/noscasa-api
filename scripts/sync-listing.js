// api/sync-listing.js
// Runs daily at 03:00 UTC via Vercel Cron (configured in vercel.json).
// Fetches property data from Guesty and upserts it into the Webflow Listings collection.
// This keeps your Webflow site content (description, price, photos) in sync automatically.

const { guesty } = require('../lib/guesty');
const { createItem, updateItem, publishItems, getAllItems } = require('../lib/webflow');

module.exports = async (req, res) => {
  try {
    // ── Fetch listing from Guesty ────────────────────────────────────────
    const listing = await guesty('GET', `/listings/${process.env.GUESTY_LISTING_ID}`);

    const fieldData = {
      name: listing.title || listing.nickname,
      slug: (listing.nickname || listing._id).toLowerCase().replace(/\s+/g, '-'),
      'property-description': listing.publicDescription?.summary || '',
      'bedrooms': listing.bedrooms || 0,
      'bathrooms': listing.bathrooms || 0,
      'accommodates': listing.accommodates || 0,
      'price-per-night': listing.prices?.basePrice || 0,
      'currency': listing.prices?.currency || 'EUR',
      'cover-image-url': listing.pictures?.[0]?.original || '',
      'address': listing.address?.full || '',
      'amenities': (listing.amenities || []).join(', '),
      'guesty-listing-id': listing._id,
      'is-available': true,
    };

    // ── Check if item already exists in Webflow ──────────────────────────
    const collectionId = process.env.WEBFLOW_LISTINGS_COLLECTION_ID;
    const existing = await getAllItems(collectionId);
    const match = existing.find(i => i.fieldData?.['guesty-listing-id'] === listing._id);

    let item;
    if (match) {
      item = await updateItem(collectionId, match.id, fieldData);
      console.log('✓ Webflow listing updated:', item.id);
    } else {
      item = await createItem(collectionId, fieldData);
      console.log('✓ Webflow listing created:', item.id);
    }

    await publishItems(collectionId, [item.id]);
    console.log('✓ Published');

    res.status(200).json({ success: true, webflowItemId: item.id, listing: listing.title });
  } catch (err) {
    console.error('[sync-listing]', err.response?.data || err.message);
    res.status(500).json({ error: 'Sync failed', detail: err.message });
  }
};