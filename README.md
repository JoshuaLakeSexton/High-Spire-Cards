# High Spire Website + Subscription Gating

## Subscription gating: how it works
1. Website user signs in (Netlify Identity) and clicks `Continue to Checkout` on `/trial`.
2. `POST /.netlify/functions/create-checkout-session`:
   - requires website auth
   - ensures `users` row exists
   - ensures Stripe customer mapping exists in `stripe_customers`
   - creates Stripe Checkout subscription session
3. Stripe sends webhook events to `POST /.netlify/functions/stripe-webhook`.
4. Webhook verifies signature and upserts `entitlements` (`plan`, `status`, `current_period_end`, `stripe_subscription_id`).
5. Website calls `POST /.netlify/functions/mint-app-token` to mint a short-lived app JWT.
6. Base44 app sends that JWT to `GET /.netlify/functions/me`.
7. Access is granted only when status is `active` or `trialing`.

## Required environment variables
- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_PRO`
- `APP_JWT_SECRET`
- `PUBLIC_SITE_URL` (for example `https://highspirelearning.com`)
- `PUBLIC_APP_URL` (Base44 app URL)
- optional: `STRIPE_PORTAL_RETURN_URL`
- optional: `STRIPE_TRIAL_DAYS` (default `3`)

## Database migration
Run:

```sql
-- file: db/migrations/001_subscription_gating.sql
```

This creates:
- `users`
- `stripe_customers`
- `entitlements`
- `stripe_event_logs` (idempotency guard for webhook replay safety)

## Functions
- `POST /.netlify/functions/create-checkout-session`
- `POST /.netlify/functions/stripe-webhook`
- `GET /.netlify/functions/me`
- `POST /.netlify/functions/mint-app-token`
- `POST /.netlify/functions/create-portal-session`

## Local testing guide
1. Start local dev server with env vars loaded (Netlify dev recommended):
   - `npx netlify dev`
2. Forward Stripe webhooks:
   - `stripe listen --forward-to http://localhost:8888/.netlify/functions/stripe-webhook`
3. Copy the webhook signing secret from Stripe CLI output into `STRIPE_WEBHOOK_SECRET`.
4. Run trial flow in browser:
   - sign in on `/trial`
   - click checkout
   - use Stripe test card `4242 4242 4242 4242`
5. Verify DB updates:
   - `stripe_customers` has mapping for the signed-in user
   - `entitlements.status` becomes `trialing` or `active`
6. Verify app unlock:
   - call `POST /.netlify/functions/mint-app-token`
   - open returned `app_url`
   - Base44 calls `GET /.netlify/functions/me` with `Authorization: Bearer <app_jwt>`
7. Simulate cancellation:
   - cancel subscription in Stripe test dashboard
   - trigger/update webhook events
   - verify `entitlements.status` changes to `canceled` and app relocks

## Base44 integration snippet
```js
const SITE_URL = "https://highspirelearning.com";
const TOKEN_KEY = "high_spire_app_token";

function readToken() {
  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get("token");
  if (tokenFromUrl) {
    localStorage.setItem(TOKEN_KEY, tokenFromUrl);
    return tokenFromUrl;
  }
  return localStorage.getItem(TOKEN_KEY);
}

async function loadAccess() {
  const token = readToken();
  if (!token) {
    return { locked: true, reason: "no_token" };
  }

  const res = await fetch(`${SITE_URL}/.netlify/functions/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    return { locked: true, reason: "auth_failed" };
  }

  const data = await res.json();
  const unlocked = data.status === "active" || data.status === "trialing";
  return { locked: !unlocked, data };
}
```

## Important setup note
You must enable website auth (Netlify Identity) for purchase flow + user linking. Without website auth, users cannot be reliably mapped to entitlements.
