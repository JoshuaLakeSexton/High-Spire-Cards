# High Spire Website + Base44 Access

## Auth and access flow
1. Website auth is Netlify Identity only.
2. User signs in on `/trial`.
3. `POST /.netlify/functions/create-checkout-session` requires authenticated website user.
4. Stripe Checkout completes and redirects to `/success`.
5. Stripe webhook (`POST /.netlify/functions/stripe-webhook`) upserts Postgres entitlements.
6. `/success` calls `GET /.netlify/functions/me` with the Identity JWT:
   - `active` or `trialing` -> show `Enter App`
   - anything else -> poll for up to 20 seconds
7. Clicking `Enter App` calls `POST /.netlify/functions/mint-app-token` and redirects to `PUBLIC_APP_URL?token=...`.
8. Base44 reads token and calls `GET https://www.highspirelearning.com/.netlify/functions/me`.
   - `active` or `trialing` -> unlocked
   - otherwise -> locked/paywall state

## Required env vars
- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_PRO`
- `APP_JWT_SECRET`
- `PUBLIC_SITE_URL=https://www.highspirelearning.com`
- `PUBLIC_APP_URL=<BASE44_APP_URL>`
- optional: `STRIPE_PORTAL_RETURN_URL`
- optional: `STRIPE_TRIAL_DAYS` (default `3`)

## Database migrations
- `db/migrations/001_subscription_gating.sql`
- `db/migrations/002_entitlements_email.sql`

Tables:
- `users(id, email, created_at)`
- `stripe_customers(user_id, stripe_customer_id)`
- `entitlements(user_id, email, plan, status, current_period_end, stripe_subscription_id, updated_at)`
- `stripe_event_logs(event_id, event_type, created_at)` for webhook idempotency

## Netlify functions
- `POST /.netlify/functions/create-checkout-session`
- `POST /.netlify/functions/stripe-webhook`
- `GET /.netlify/functions/me`
- `POST /.netlify/functions/mint-app-token`
- `POST /.netlify/functions/create-portal-session`

All functions return CORS headers and support `OPTIONS` for Base44 cross-origin calls.

## Local test flow
1. Run site locally:
   - `npx netlify dev`
2. Forward Stripe webhooks:
   - `stripe listen --forward-to http://localhost:8888/.netlify/functions/stripe-webhook`
3. Set webhook secret from Stripe CLI output into `STRIPE_WEBHOOK_SECRET`.
4. Visit `/trial`, sign in with Netlify Identity, click `Continue to Checkout`.
5. Complete checkout (Stripe test card: `4242 4242 4242 4242`).
6. On `/success`, confirm `Enter App` appears.
7. Verify `GET /.netlify/functions/me` returns `status: trialing` or `active`.

## Base44 integration skeleton
```js
const SITE_URL = "https://www.highspirelearning.com";
const TOKEN_KEY = "high_spire_app_token";

function readToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("token");
  if (fromUrl) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    params.delete("token");
    history.replaceState({}, "", `${location.pathname}?${params.toString()}`.replace(/\?$/, ""));
    return fromUrl;
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

async function getAccess() {
  const token = readToken();
  if (!token) return { unlocked: false, status: "inactive" };

  const res = await fetch(`${SITE_URL}/.netlify/functions/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { unlocked: false, status: "inactive" };
  const me = await res.json();
  const unlocked = me.status === "active" || me.status === "trialing";
  return { unlocked, status: me.status, email: me.email, plan: me.plan };
}
```

Locked screen behavior in Base44:
- Message: `Subscription required to access High Spire.`
- `Start Free Trial` button -> `https://www.highspirelearning.com/trial`
- `Manage Billing` button:
  - call `POST https://www.highspirelearning.com/.netlify/functions/create-portal-session`
  - header: `Authorization: Bearer <app_token>`
  - redirect to returned `url`
