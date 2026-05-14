# NoesCasa Booking Backend
**Guesty Open API + Webflow + Stripe/Mollie — end-to-end setup guide**

---

## Project structure

```
noscasa/
├── api/
│   ├── listing.js          ← GET  /api/listing
│   ├── availability.js     ← GET  /api/availability
│   ├── pricing.js          ← GET  /api/pricing
│   ├── payment.js          ← POST /api/payment  (Stripe or Mollie)
│   ├── reserve.js          ← POST /api/reserve  (creates Guesty reservation)
│   ├── mollie-webhook.js   ← POST /api/mollie-webhook
│   └── cron-sync.js        ← GET  /api/cron-sync (daily Webflow sync)
├── lib/
│   ├── guesty.js           ← Guesty OAuth2 client
│   └── cors.js             ← CORS middleware
├── scripts/
│   └── sync-to-webflow.js  ← Guesty → Webflow CMS sync script
├── public/
│   └── webflow-embed.html  ← Paste this into Webflow Custom Code Embed
├── package.json
└── vercel.json
```

---

## Step 1 — Get your Guesty API credentials

1. Log in to your Guesty dashboard → **Integrations → API**
2. Create an **Open API** application (not Guesty for Hosts)
3. Copy your **Client ID** and **Client Secret**
4. Note your **Listing ID** from the listing URL

---

## Step 2 — Deploy to Vercel

```bash
npm install -g vercel
cd noscasa
npm install
vercel login
vercel
```

Then set your environment variables in the Vercel dashboard or CLI:

```bash
vercel env add GUESTY_CLIENT_ID
vercel env add GUESTY_CLIENT_SECRET
vercel env add GUESTY_LISTING_ID
vercel env add STRIPE_SECRET_KEY         # if using Stripe
vercel env add MOLLIE_API_KEY            # if using Mollie
vercel env add PAYMENT_PROVIDER          # "stripe" or "mollie"
vercel env add ALLOWED_ORIGIN            # https://your-site.webflow.io
vercel env add WEBFLOW_API_TOKEN
vercel env add WEBFLOW_COLLECTION_ID
vercel env add CRON_SECRET               # any random secret string
```

---

## Step 3 — Sync listing to Webflow CMS

Create a **Properties** collection in Webflow with these fields:

| Field slug            | Type       |
|-----------------------|------------|
| name                  | Plain text |
| property-description  | Plain text |
| bedrooms              | Number     |
| bathrooms             | Number     |
| accommodates          | Number     |
| price-per-night       | Number     |
| currency              | Plain text |
| cover-image-url       | Plain text |
| address               | Plain text |
| amenities             | Plain text |
| is-available          | Switch     |

Then run the sync manually once:

```bash
GUESTY_CLIENT_ID=xxx \
GUESTY_CLIENT_SECRET=xxx \
GUESTY_LISTING_ID=xxx \
WEBFLOW_API_TOKEN=xxx \
WEBFLOW_COLLECTION_ID=xxx \
node scripts/sync-to-webflow.js
```

Note the `WEBFLOW_ITEM_ID` printed in the console and add it to your Vercel env vars
so future syncs update rather than create.

---

## Step 4 — Embed the booking widget in Webflow

1. Open your Webflow project
2. Find the dark **"Book your peace and quiet now"** section
3. Add an **Embed** component inside it
4. Paste the contents of `public/webflow-embed.html` into the embed
5. Replace the config values at the top of the `<script>`:

```js
const API_BASE = 'https://YOUR-PROJECT.vercel.app';
const STRIPE_PK = 'pk_live_XXXXXXXXXXXX';
const PAYMENT_PROVIDER = 'stripe'; // or 'mollie'
```

6. Publish your Webflow site

---

## Step 5 — Set up Stripe (if using Stripe)

1. Create a Stripe account at stripe.com
2. Get your **Secret key** (sk_live_...) → Vercel env `STRIPE_SECRET_KEY`
3. Get your **Publishable key** (pk_live_...) → paste into `webflow-embed.html`
4. In Stripe dashboard, enable EUR payments

---

## Step 5 — Set up Mollie (if using Mollie)

1. Create a Mollie account at mollie.com (popular in Belgium/Netherlands)
2. Get your **Live API key** → Vercel env `MOLLIE_API_KEY`
3. Set `PAYMENT_PROVIDER=mollie` in Vercel env vars
4. Register your webhook URL in Mollie dashboard:
   `https://YOUR-PROJECT.vercel.app/api/mollie-webhook`

---

## Booking flow (end-to-end)

```
User selects dates
      ↓
GET /api/availability  →  Guesty calendar API
      ↓
GET /api/pricing       →  Guesty quote API
      ↓
User fills in details
      ↓
POST /api/payment      →  Stripe PaymentIntent / Mollie Payment
      ↓
Stripe.js confirms card (or Mollie redirect)
      ↓
POST /api/reserve      →  Creates guest + reservation in Guesty
      ↓
Confirmation screen shown, email sent by Guesty
```

---

## Daily CMS sync (automatic)

Add this to `vercel.json` to auto-sync every day at 03:00 UTC:

```json
"crons": [{ "path": "/api/cron-sync", "schedule": "0 3 * * *" }]
```

---

## Questions?
Check Guesty Open API docs: https://open-api.guesty.com
Webflow CMS API docs: https://developers.webflow.com
Stripe docs: https://stripe.com/docs
Mollie docs: https://docs.mollie.com