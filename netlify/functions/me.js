const Stripe = require("stripe");

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  };
}

function normalizeSubscriptionStatus(status) {
  const allowed = new Set([
    "active",
    "trialing",
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
  ]);

  if (!status || !allowed.has(status)) {
    return "inactive";
  }

  return status;
}

function scoreStatus(status) {
  switch (status) {
    case "active":
      return 0;
    case "trialing":
      return 1;
    case "past_due":
      return 2;
    case "unpaid":
      return 3;
    case "incomplete":
      return 4;
    case "incomplete_expired":
      return 5;
    case "paused":
      return 6;
    case "canceled":
      return 7;
    default:
      return 8;
  }
}

function pickBestSubscription(subscriptions) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return null;
  }

  const sorted = [...subscriptions].sort((a, b) => {
    const scoreDiff = scoreStatus(a.status) - scoreStatus(b.status);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return (b.current_period_end || 0) - (a.current_period_end || 0);
  });

  return sorted[0];
}

function toIsoFromUnix(seconds) {
  if (!seconds) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

async function findCustomerByIdentity(stripe, { email, userId }) {
  const list = await stripe.customers.list({ email, limit: 10 });
  if (!list.data.length) {
    return null;
  }

  return (
    list.data.find((item) => item.metadata && item.metadata.user_id === userId) ||
    list.data[0] ||
    null
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method Not Allowed" });
  }

  const identityUser = event.clientContext && event.clientContext.user;
  if (!identityUser || !identityUser.email || !identityUser.sub) {
    return json(401, { error: "Authentication required." });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { error: "Server misconfiguration: STRIPE_SECRET_KEY is missing." });
  }

  const appUrl = process.env.PUBLIC_APP_URL || "/";

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const email = String(identityUser.email).toLowerCase();
    const userId = identityUser.sub;

    const customer = await findCustomerByIdentity(stripe, { email, userId });
    if (!customer) {
      return json(200, {
        email,
        plan: null,
        status: "inactive",
        current_period_end: null,
        app_url: appUrl,
      });
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 20,
    });

    const best = pickBestSubscription(subscriptions.data || []);
    if (!best) {
      return json(200, {
        email,
        plan: null,
        status: "inactive",
        current_period_end: null,
        app_url: appUrl,
      });
    }

    return json(200, {
      email,
      plan: "pro",
      status: normalizeSubscriptionStatus(best.status),
      current_period_end: toIsoFromUnix(best.current_period_end),
      app_url: appUrl,
    });
  } catch (err) {
    return json(500, {
      error: err && err.message ? err.message : "Unable to fetch subscription status.",
    });
  }
};
