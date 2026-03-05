const Stripe = require("stripe");
const { requireWebsiteUser } = require("./_lib/auth");
const {
  withClient,
  ensureUser,
  getStripeCustomerForUser,
  upsertStripeCustomer,
} = require("./_lib/db");
const { json, methodNotAllowed, normalizeBaseUrl, parseJsonBody } = require("./_lib/http");

async function findOrCreateCustomer(stripe, user) {
  const existing = await withClient(async (client) => {
    await ensureUser(client, user);
    return getStripeCustomerForUser(client, user.id);
  });

  if (existing) {
    return existing;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { user_id: user.id },
  });

  await withClient(async (client) => {
    await ensureUser(client, user);
    await upsertStripeCustomer(client, user.id, customer.id);
  });

  return customer.id;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowed();
  }

  let websiteUser;
  try {
    websiteUser = requireWebsiteUser(event);
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || "Authentication required." });
  }

  const body = parseJsonBody(event);
  if (body === null) {
    return json(400, { error: "Invalid JSON body." });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID_PRO || process.env.STRIPE_PRICE_ID;
  if (!secretKey) {
    return json(500, { error: "Server misconfiguration: STRIPE_SECRET_KEY is missing." });
  }
  if (!priceId) {
    return json(500, { error: "Server misconfiguration: STRIPE_PRICE_ID_PRO is missing." });
  }

  const requestedPriceId = typeof body.priceId === "string" ? body.priceId.trim() : "";
  if (requestedPriceId && requestedPriceId !== priceId) {
    return json(400, { error: "Requested price does not match configured plan." });
  }

  const siteUrl = normalizeBaseUrl(process.env.PUBLIC_SITE_URL, "https://highspirelearning.com");
  const useTrial = body.trial !== false;
  const trialDaysRaw = Number.parseInt(process.env.STRIPE_TRIAL_DAYS || "3", 10);
  const trialDays = Number.isFinite(trialDaysRaw) && trialDaysRaw > 0 ? trialDaysRaw : 3;

  try {
    const stripe = new Stripe(secretKey);
    const stripeCustomerId = await findOrCreateCustomer(stripe, websiteUser);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_collection: "always",
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/trial`,
      metadata: { user_id: websiteUser.id },
      subscription_data: {
        metadata: { user_id: websiteUser.id },
        ...(useTrial ? { trial_period_days: trialDays } : {}),
      },
    });

    if (!session.url) {
      return json(500, { error: "Stripe did not return a checkout URL." });
    }

    return json(200, { url: session.url });
  } catch (err) {
    return json(500, {
      error: err && err.message ? err.message : "Unable to create checkout session.",
    });
  }
};
