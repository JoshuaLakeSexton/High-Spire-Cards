const Stripe = require("stripe");

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  };
}

function parseBody(event) {
  if (!event.body) {
    return {};
  }

  try {
    return JSON.parse(event.body);
  } catch (_err) {
    return null;
  }
}

function normalizeBaseUrl(input, fallback) {
  const source = typeof input === "string" && input.trim() ? input.trim() : fallback;
  return source.replace(/\/+$/, "");
}

async function findOrCreateCustomer(stripe, { userId, email }) {
  const listed = await stripe.customers.list({ email, limit: 10 });

  let customer =
    listed.data.find((item) => item.metadata && item.metadata.user_id === userId) ||
    listed.data[0] ||
    null;

  if (!customer) {
    customer = await stripe.customers.create({
      email,
      metadata: { user_id: userId },
    });
    return customer;
  }

  const shouldPatchMetadata = !customer.metadata || customer.metadata.user_id !== userId;
  if (shouldPatchMetadata) {
    customer = await stripe.customers.update(customer.id, {
      email,
      metadata: { ...(customer.metadata || {}), user_id: userId },
    });
  }

  return customer;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  const identityUser = event.clientContext && event.clientContext.user;
  if (!identityUser || !identityUser.email || !identityUser.sub) {
    return json(401, { error: "Authentication required. Please sign in and try again." });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const configuredPriceId = process.env.STRIPE_PRICE_ID_PRO || process.env.STRIPE_PRICE_ID;

  if (!secretKey) {
    return json(500, { error: "Server misconfiguration: STRIPE_SECRET_KEY is missing." });
  }

  if (!configuredPriceId) {
    return json(500, {
      error: "Server misconfiguration: STRIPE_PRICE_ID_PRO (or STRIPE_PRICE_ID) is missing.",
    });
  }

  const body = parseBody(event);
  if (body === null) {
    return json(400, { error: "Invalid JSON request body." });
  }

  const requestedPriceId = typeof body.priceId === "string" ? body.priceId.trim() : "";
  if (requestedPriceId && requestedPriceId !== configuredPriceId) {
    return json(400, { error: "Requested price does not match configured plan." });
  }

  const useTrial = body.trial !== false;
  const trialDaysRaw = Number.parseInt(process.env.STRIPE_TRIAL_DAYS || "3", 10);
  const trialDays = Number.isFinite(trialDaysRaw) && trialDaysRaw > 0 ? trialDaysRaw : 3;

  const siteUrl = normalizeBaseUrl(process.env.PUBLIC_SITE_URL, "https://highspirelearning.com");

  try {
    const stripe = new Stripe(secretKey);
    const userId = identityUser.sub;
    const email = String(identityUser.email).toLowerCase();
    const customer = await findOrCreateCustomer(stripe, { userId, email });

    const sessionPayload = {
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: configuredPriceId, quantity: 1 }],
      payment_method_collection: "always",
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/trial`,
      metadata: { user_id: userId },
      subscription_data: {
        metadata: { user_id: userId },
      },
    };

    if (useTrial) {
      sessionPayload.subscription_data.trial_period_days = trialDays;
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);
    if (!session.url) {
      return json(500, { error: "Stripe session created without a redirect URL." });
    }

    return json(200, { url: session.url });
  } catch (err) {
    return json(500, {
      error: err && err.message ? err.message : "Unable to create checkout session.",
    });
  }
};
