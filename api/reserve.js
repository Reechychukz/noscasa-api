// api/reserve.js
// POST /api/reserve
// Called after Stripe payment is confirmed on the frontend.
// 1. Creates a confirmed reservation in Guesty (inline guest, no pre-creation needed)
// 2. Records the Stripe payment against the reservation in Guesty
// 3. Saves a booking record to Webflow CMS (non-fatal if it fails)

const { guesty } = require('../lib/guesty');
const { createItem, publishItems } = require('../lib/webflow');
const { cors } = require('../lib/cors');
const { validateReservationPayload } = require('../lib/booking-validation');

module.exports = async (req, res) => {
    if (cors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const validation = validateReservationPayload(req.body);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
    }

    const {
        listingId: effectiveListingId,
        guests: guestsCount,
        guest,
        notes,
        paymentIntentId,
        bookingRef,
        checkIn,
        checkOut,
        pricing,
    } = validation;

    try {
        // ── Step 1: Create reservation in Guesty ──────────────────────────────
        // Per docs: guest can be passed inline — no separate guest creation needed.
        // Only send fields defined in the OpenAPI schema.
        // Required: listingId, checkInDateLocalized, checkOutDateLocalized, status
        // money.fareAccommodation and money.currency are required within money.
        const reservationBody = {
            listingId: effectiveListingId,
            checkInDateLocalized: checkIn,
            checkOutDateLocalized: checkOut,
            status: 'confirmed',
            guestsCount: guestsCount || 2,
            guest: {
                firstName: guest.firstName,
                lastName: guest.lastName,
                email: guest.email,
                phone: guest.phone || '',
            },
            money: {
                fareAccommodation: pricing.fareAccommodation,
                fareCleaning: pricing.fareCleaning || 0,
                currency: pricing.currency || 'EUR',
            },
        };

        const reservation = await guesty('POST', '/reservations', reservationBody);

        if (!reservation?._id) {
            throw new Error('Guesty did not return a reservation ID');
        }

        const reservationId = reservation._id;
        const confirmationCode = reservation.confirmationCode || bookingRef;

        // ── Step 2: Record the Stripe payment against the reservation ─────────
        // This marks the reservation as paid in Guesty using the "recorded payment"
        // approach — the funds were already collected externally via Stripe.
        if (pricing.totalPrice && pricing.totalPrice > 0) {
            try {
                await guesty('POST', `/reservations/${reservationId}/payments`, {
                    paymentMethod: {
                        method: 'OTHER',   // funds already collected by our Stripe integration
                    },
                    amount: pricing.totalPrice,
                    paidAt: new Date().toISOString(),
                    note: paymentIntentId
                        ? `Stripe payment intent: ${paymentIntentId}`
                        : 'Paid via Stripe on booking',
                });
            } catch (payErr) {
                // Non-fatal: reservation exists, payment recording failed
                console.error('[reserve] Payment recording failed (non-fatal):', payErr.message);
            }
        }

        // ── Step 3: Save booking record to Webflow CMS ─────────────────────────
        let webflowItemId = null;
        try {
            const wfItem = await createItem(process.env.WEBFLOW_BOOKINGS_COLLECTION_ID, {
              name: `${guest.firstName} ${guest.lastName} — ${checkIn}`,
              slug: confirmationCode.toLowerCase(),
              'guest-first-name': guest.firstName,
              'guest-last-name': guest.lastName,
              'guest-email': guest.email,
              'guest-phone': guest.phone || '',
              'check-in': checkIn,
              'check-out': checkOut,
              'guests-count': guestsCount || 2,
              'special-requests': notes || '',
              'fare-accommodation': pricing.fareAccommodation,
              'fare-cleaning': pricing.fareCleaning || 0,
              'city-tax': pricing.cityTax || 0,
              'total-price': pricing.totalPrice,
              currency: pricing.currency || 'EUR',
              'booking-ref': confirmationCode,
              'guesty-reservation-id': reservationId,
              'stripe-payment-intent': paymentIntentId || '',
              'booking-status': 'confirmed',
              'booked-at': new Date().toISOString(),
            });
            await publishItems(process.env.WEBFLOW_BOOKINGS_COLLECTION_ID, [wfItem.id]);
            webflowItemId = wfItem.id;
        } catch (wfErr) {
            console.error('[reserve] Webflow save failed (non-fatal):', wfErr.message);
        }

        res.status(201).json({
            success: true,
            bookingRef: confirmationCode,
            reservationId,
            webflowItemId,
        });
    } catch (err) {
        console.error('[reserve]', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to create reservation' });
    }
};