const Stripe = require("stripe");
const { getWebsiteUser, verifyAppToken } = require("./_lib/auth");
const { withClient, getStripeCustomerForUser } = require("./_lib/db");
const { json, methodNotAllowed, normalizeBaseUrl } = require("./_lib/http");

function resolveAuthenticatedUser(event) {
  const websiteUser = getWebsiteUser(event);

  try {
    const appUser = verifyAppToken(event);
    if (appUser) {
      return appUser;
    }
  } catch (err) {
    if (!websiteUser) {
      throw err;
    }
  }

  return websiteUser;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowed();
  }

  let user;
  try {
    user = resolveAuthenticatedUser(event);
    if (!user) {
      return json(401, { error: "Authentication required." });
    }
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || "Authentication required." });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return json(500, { error: "Server misconfiguration: STRIPE_SECRET_KEY is missing." });
  }

  const siteUrl = normalizeBaseUrl(process.env.PUBLIC_SITE_URL, "https://highspirelearning.com");
  const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || `${siteUrl}/success`;

  try {
    const stripeCustomerId = await withClient((client) =>
      getStripeCustomerForUser(client, user.id)
    );

    if (!stripeCustomerId) {
      return json(404, { error: "No Stripe customer found for this user." });
    }

    const stripe = new Stripe(secretKey);
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return json(200, { url: session.url });
  } catch (err) {
    return json(500, {
      error: err && err.message ? err.message : "Unable to create billing portal session.",
    });
  }
};
