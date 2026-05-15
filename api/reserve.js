// api/reserve.js
// POST /api/reserve
// Called after Stripe payment is confirmed on the frontend.
// Does two things:
//   1. Creates a confirmed reservation in Guesty
//   2. Saves a booking record to Webflow CMS (Bookings collection)
//
// Body: {
//   checkIn, checkOut, guests, guest: { firstName, lastName, email, phone },
//   pricing: { fareAccommodation, fareCleaning, cityTax, totalPrice, currency },
//   notes, paymentIntentId, bookingRef
// }

const { guesty } = require('../lib/guesty');
const { createItem, publishItems } = require('../lib/webflow');
const { cors } = require('../lib/cors');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { checkIn, checkOut, guests, guest, pricing, notes, paymentIntentId, bookingRef, listingId, listing_id } = req.body;
  const effectiveListingId = listingId || listing_id || process.env.GUESTY_LISTING_ID;

  if (!checkIn || !checkOut || !guest?.email || !effectiveListingId) {
    return res.status(400).json({ error: 'Missing required fields: checkIn, checkOut, guest.email, listingId/listing_id' });
  }

  try {
    // ── Step 1: Create or find guest in Guesty ─────────────────────────────
    let guestId;
    try {
      const newGuest = await guesty('POST', '/guests', {
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email,
        phone: guest.phone || '',
      });
      guestId = newGuest._id;
    } catch {
      // Guest already exists — find by email
      const existing = await guesty('GET', '/guests', null, { email: guest.email });
      guestId = existing.results?.[0]?._id;
      if (!guestId) throw new Error('Could not create or find guest in Guesty');
    }

    // ── Step 2: Create reservation in Guesty ──────────────────────────────
    const reservation = await guesty('POST', '/reservations', {
      listingId: effectiveListingId,
      checkInDateLocalized: checkIn,
      checkOutDateLocalized: checkOut,
      guestsCount: guests || 2,
      guestId,
      source: 'webflow-direct',
      status: 'confirmed',
      money: {
        fareAccommodation: pricing.fareAccommodation,
        fareCleaning: pricing.fareCleaning,
        fareCityTax: pricing.cityTax,
        totalPrice: pricing.totalPrice,
        currency: pricing.currency || 'EUR',
        balanceDue: 0,
      },
      guestNotes: notes || '',
    });

    const confirmationCode = reservation.confirmationCode || bookingRef;

    // ── Step 3: Save booking record to Webflow CMS ─────────────────────────
    // This creates a record in your Bookings CMS collection so you can
    // view and manage all bookings directly inside Webflow.
    const wfItem = await createItem(process.env.WEBFLOW_BOOKINGS_COLLECTION_ID, {
      // Required Webflow fields
      name: `${guest.firstName} ${guest.lastName} — ${checkIn}`,
      slug: confirmationCode.toLowerCase(),

      // Guest details
      'guest-first-name': guest.firstName,
      'guest-last-name': guest.lastName,
      'guest-email': guest.email,
      'guest-phone': guest.phone || '',

      // Stay details
      'check-in': checkIn,
      'check-out': checkOut,
      'guests-count': guests || 2,
      'special-requests': notes || '',

      // Pricing
      'fare-accommodation': pricing.fareAccommodation,
      'fare-cleaning': pricing.fareCleaning,
      'city-tax': pricing.cityTax,
      'total-price': pricing.totalPrice,
      'currency': pricing.currency || 'EUR',

      // References
      'booking-ref': confirmationCode,
      'guesty-reservation-id': reservation._id,
      'stripe-payment-intent': paymentIntentId || '',
      'booking-status': 'confirmed',
      'booked-at': new Date().toISOString(),
    });

    // Publish so it's visible in Webflow CMS dashboard
    await publishItems(process.env.WEBFLOW_BOOKINGS_COLLECTION_ID, [wfItem.id]);

    res.status(201).json({
      success: true,
      bookingRef: confirmationCode,
      reservationId: reservation._id,
      webflowItemId: wfItem.id,
    });
  } catch (err) {
    console.error('[reserve]', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create reservation' });
  }
};