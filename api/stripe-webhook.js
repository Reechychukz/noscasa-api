// api/stripe-webhook.js
// POST /api/stripe-webhook
// Stripe calls this after payment events. We use payment_intent.succeeded
// as a safety net — if the frontend reserve call failed for any reason,
// this ensures the booking still gets created in Guesty + Webflow.
//
// Register this URL in Stripe dashboard → Developers → Webhooks:
//   https://YOUR-PROJECT.vercel.app/api/stripe-webhook
// Event to listen for: payment_intent.succeeded

const Stripe = require('stripe');
const { createItem, publishItems } = require('../lib/webflow');

module.exports = async (req, res) => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    // Verify the webhook came from Stripe (not a spoofed request)
    event = stripe.webhooks.constructEvent(
      req.body,                          // raw body — see note below
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const { bookingRef } = intent.metadata;

    console.log(`[stripe-webhook] Payment succeeded for booking ${bookingRef} — €${intent.amount / 100}`);

    // The frontend calls /api/reserve after payment, which handles Guesty + Webflow.
    // This webhook is the safety net: if that call failed, log it here
    // and you can manually trigger a re-sync or alert yourself.

    // Optional: update the Webflow booking status to 'paid' if not already done
    // (requires storing the Webflow item ID somewhere, e.g. in Stripe metadata)
  }

  res.status(200).json({ received: true });
};

// IMPORTANT: Vercel parses req.body as JSON by default, but Stripe needs the RAW body
// to verify the webhook signature. Add this export config to disable body parsing:
module.exports.config = { api: { bodyParser: false } };