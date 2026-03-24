const Stripe = require("stripe");
const { requireWebsiteUser } = require("./_lib/auth");
const {
  withClient,
  ensureUser,
  findOrCreateUserByEmail,
  getStripeCustomerForUser,
  upsertStripeCustomer,
} = require("./_lib/db");
const { json, methodNotAllowed, normalizeBaseUrl, optionsResponse, parseJsonBody } = require("./_lib/http");

async function getOrCreateStripeCustomer(stripe, user) {
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

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return optionsResponse();
  }

  if (event.httpMethod !== "POST") {
    return methodNotAllowed();
  }

  const body = parseJsonBody(event);
  if (body === null) {
    return json(400, { error: "Invalid JSON body." });
  }

  let user;
  try {
    user = requireWebsiteUser(event);
  } catch (err) {
    user = null;
  }

  if (!user) {
    const emailFromBody = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!isValidEmail(emailFromBody)) {
      return json(401, {
        error: "Authentication required. Sign in or provide a valid email to continue.",
      });
    }

    try {
      const dbUser = await withClient(async (client) => findOrCreateUserByEmail(client, emailFromBody));
      user = {
        id: dbUser.id,
        email: dbUser.email,
      };
    } catch (dbErr) {
      return json(500, {
        error: dbErr && dbErr.message ? dbErr.message : "Unable to create user record.",
      });
    }
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

  const siteUrl = normalizeBaseUrl(process.env.PUBLIC_SITE_URL, "https://www.highspirelearning.com");
  const useTrial = body.trial !== false;
  const trialDaysRaw = Number.parseInt(process.env.STRIPE_TRIAL_DAYS || "3", 10);
  const trialDays = Number.isFinite(trialDaysRaw) && trialDaysRaw > 0 ? trialDaysRaw : 3;

  try {
    const stripe = new Stripe(secretKey);
    const normalizedUser = {
      id: String(user.id),
      email: String(user.email).toLowerCase(),
    };

    const stripeCustomerId = await getOrCreateStripeCustomer(stripe, normalizedUser);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_collection: "always",
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/trial`,
      metadata: { user_id: normalizedUser.id },
      subscription_data: {
        metadata: { user_id: normalizedUser.id },
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
