// api/payment.js
// POST /api/payment
// Creates a Stripe PaymentIntent and returns the clientSecret to the widget.
// The widget uses the clientSecret to complete the payment on the frontend via Stripe.js.
//
// Body: { amountCents, currency, bookingRef, guestEmail, description }

const Stripe = require('stripe');
const { cors } = require('../lib/cors');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { amountCents, currency, bookingRef, guestEmail, description } = req.body;

  if (!amountCents || !bookingRef) {
    return res.status(400).json({ error: 'Missing required fields: amountCents, bookingRef' });
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,             // e.g. 36500 = €365.00
      currency: currency || 'eur',
      receipt_email: guestEmail,
      description,
      metadata: { bookingRef },
      automatic_payment_methods: { enabled: true },
    });

    res.status(200).json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
    });
  } catch (err) {
    console.error('[payment]', err.message);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
};