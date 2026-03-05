const Stripe = require("stripe");
const { getBearerToken, getWebsiteUser, verifyAppToken } = require("./_lib/auth");
const { withClient, isDatabaseConnectivityError, ensureUser } = require("./_lib/db");
const { json, methodNotAllowed, toIsoString } = require("./_lib/http");

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due", "canceled", "unpaid"]);

function normalizeStatus(status) {
  return ACTIVE_STATUSES.has(status) ? status : "inactive";
}

function formatEntitlement(email, plan, status, periodEnd) {
  return {
    email,
    plan: plan || null,
    status: normalizeStatus(status),
    current_period_end: toIsoString(periodEnd),
  };
}

async function getEntitlement(client, userId) {
  const result = await client.query(
    `
      SELECT
        u.email,
        e.plan,
        e.status,
        e.current_period_end
      FROM users u
      LEFT JOIN entitlements e ON e.user_id = u.id
      WHERE u.id = $1::uuid
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

function resolveAuthenticatedUser(event) {
  const token = getBearerToken(event);
  const websiteUser = getWebsiteUser(event);
  if (!token) {
    return websiteUser;
  }

  try {
    return verifyAppToken(event);
  } catch (err) {
    if (websiteUser) {
      return websiteUser;
    }
    throw err;
  }
}

async function getStripeEntitlementByEmail(email) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return formatEntitlement(email, null, "inactive", null);
  }

  const stripe = new Stripe(stripeKey);
  const customers = await stripe.customers.list({
    email: email.toLowerCase(),
    limit: 3,
  });

  if (!customers.data.length) {
    return formatEntitlement(email, null, "inactive", null);
  }

  let latestSubscription = null;
  for (const customer of customers.data) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 10,
    });

    for (const subscription of subscriptions.data) {
      if (!latestSubscription || Number(subscription.created || 0) > Number(latestSubscription.created || 0)) {
        latestSubscription = subscription;
      }
    }
  }

  if (!latestSubscription) {
    return formatEntitlement(email, null, "inactive", null);
  }

  return formatEntitlement(
    email,
    "pro",
    latestSubscription.status,
    latestSubscription.current_period_end ? new Date(latestSubscription.current_period_end * 1000) : null
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return methodNotAllowed();
  }

  let user;
  try {
    user = resolveAuthenticatedUser(event);
    if (!user) {
      return json(401, { error: "Authentication required." });
    }
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || "Authentication failed." });
  }

  try {
    const response = await withClient(async (client) => {
      await ensureUser(client, user);
      const row = await getEntitlement(client, user.id);
      if (!row) {
        return formatEntitlement(user.email, null, "inactive", null);
      }

      return formatEntitlement(row.email || user.email, row.plan, row.status, row.current_period_end);
    });

    return json(200, response);
  } catch (err) {
    if (isDatabaseConnectivityError(err) && user && user.email) {
      try {
        const fallback = await getStripeEntitlementByEmail(user.email);
        return json(200, fallback);
      } catch (stripeErr) {
        return json(500, {
          error:
            stripeErr && stripeErr.message
              ? stripeErr.message
              : "Unable to fetch subscription status.",
        });
      }
    }

    return json(500, {
      error: err && err.message ? err.message : "Unable to fetch subscription status.",
    });
  }
};
