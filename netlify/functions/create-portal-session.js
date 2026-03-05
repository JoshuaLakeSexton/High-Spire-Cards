const Stripe = require("stripe");

const JSON_HEADERS = { "Content-Type": "application/json" };

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  };
}

function normalizeBaseUrl(input, fallback) {
  const source = typeof input === "string" && input.trim() ? input.trim() : fallback;
  return source.replace(/\/+$/, "");
}

async function findCustomerByIdentity(stripe, { email, userId }) {
  const listed = await stripe.customers.list({ email, limit: 10 });
  if (!listed.data.length) {
    return null;
  }
  return (
    listed.data.find((item) => item.metadata && item.metadata.user_id === userId) ||
    listed.data[0] ||
    null
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method Not Allowed" });
  }

  const identityUser = event.clientContext && event.clientContext.user;
  if (!identityUser || !identityUser.email || !identityUser.sub) {
    return json(401, { error: "Authentication required. Please sign in and try again." });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { error: "Server misconfiguration: STRIPE_SECRET_KEY is missing." });
  }

  const siteUrl = normalizeBaseUrl(process.env.PUBLIC_SITE_URL, "https://highspirelearning.com");
  const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || `${siteUrl}/success`;

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const email = String(identityUser.email).toLowerCase();
    const userId = identityUser.sub;
    const customer = await findCustomerByIdentity(stripe, { email, userId });

    if (!customer) {
      return json(404, { error: "No Stripe customer found for this account." });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
    });

    return json(200, { url: session.url });
  } catch (err) {
    return json(500, {
      error: err && err.message ? err.message : "Unable to create billing portal session.",
    });
  }
};
