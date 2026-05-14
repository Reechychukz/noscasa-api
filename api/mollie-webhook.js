// api/mollie-webhook.js
// POST /api/mollie-webhook
// Mollie calls this URL after a payment status change.
// If payment succeeded, we call /api/reserve to create the Guesty reservation.
// NOTE: Mollie sends only the paymentId — we must fetch payment details ourselves.

const { applyCors } = require('../lib/cors');

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { createMollieClient } = require('@mollie/api-client');
    const mollie = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY });

    const paymentId = req.body?.id;
    if (!paymentId) return res.status(400).json({ error: 'Missing payment id' });

    const payment = await mollie.payments.get(paymentId);

    if (payment.status !== 'paid') {
      // Not paid yet — Mollie may call again when status changes
      return res.status(200).json({ received: true, status: payment.status });
    }

    const { bookingRef, guestEmail } = payment.metadata || {};

    // The booking data was stored in your DB / session when the payment was created.
    // Here we simply log it — in production, look up pending booking by bookingRef
    // from your database and then call the Guesty reserve endpoint.
    console.log(`[mollie-webhook] Payment paid for booking ${bookingRef} by ${guestEmail}`);

    // Example of calling the reserve endpoint internally:
    // const reserveRes = await fetch(`${process.env.ALLOWED_ORIGIN}/api/reserve`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(pendingBookingData),
    // });

    res.status(200).json({ received: true, status: 'paid' });
  } catch (err) {
    console.error('[mollie-webhook]', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};