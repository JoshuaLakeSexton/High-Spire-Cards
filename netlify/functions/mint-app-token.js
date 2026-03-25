const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const { requireWebsiteUser } = require("./_lib/auth");
const {
  withClient,
  ensureUser,
  findOrCreateUserByEmail,
  getUserById,
  getUserIdByStripeCustomer,
  upsertStripeCustomer,
} = require("./_lib/db");
const { json, methodNotAllowed, normalizeBaseUrl, optionsResponse, parseJsonBody } = require("./_lib/http");

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function normalizeStatus(status) {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "canceled":
    case "unpaid":
      return status;
    default:
      return "inactive";
  }
}

function toTimestamp(seconds) {
  if (!seconds) {
    return null;
  }
  return new Date(Number(seconds) * 1000);
}

async function upsertEntitlement(client, { userId, email, subscription }) {
  await client.query(
    `
      INSERT INTO entitlements (
        user_id,
        email,
        plan,
        status,
        current_period_end,
        stripe_subscription_id,
        updated_at
      )
      VALUES ($1::uuid, $2, 'pro', $3, $4, $5, now())
      ON CONFLICT (user_id)
      DO UPDATE SET
        email = EXCLUDED.email,
        plan = EXCLUDED.plan,
        status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        updated_at = now()
    `,
    [
      userId,
      email,
      normalizeStatus(subscription && subscription.status),
      toTimestamp(subscription && subscription.current_period_end),
      subscription && subscription.id ? String(subscription.id) : null,
    ]
  );
}

async function resolveUserFromCheckoutSession(sessionId) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    const err = new Error("Server misconfiguration: STRIPE_SECRET_KEY is missing.");
    err.statusCode = 500;
    throw err;
  }

  const stripe = new Stripe(secretKey);
  const session = await stripe.checkout.sessions.retrieve(String(sessionId), {
    expand: ["subscription", "customer"],
  });

  if (!session || session.mode !== "subscription") {
    const err = new Error("Invalid checkout session.");
    err.statusCode = 400;
    throw err;
  }

  if (session.status !== "complete") {
    const err = new Error("Checkout session is not complete yet.");
    err.statusCode = 409;
    throw err;
  }

  const customerId = typeof session.customer === "string" ? session.customer : session.customer && session.customer.id;
  const email =
    (session.customer_details && session.customer_details.email) ||
    (session.customer_email ? String(session.customer_email) : "") ||
    (session.customer && session.customer.email ? String(session.customer.email) : "");
  const metadataUserId = session.metadata && session.metadata.user_id ? String(session.metadata.user_id) : "";

  if (!customerId) {
    const err = new Error("Checkout session has no Stripe customer.");
    err.statusCode = 400;
    throw err;
  }

  if (!email) {
    const err = new Error("Checkout session has no customer email.");
    err.statusCode = 400;
    throw err;
  }

  const normalizedEmail = email.toLowerCase();
  let subscription = null;
  if (session.subscription) {
    if (typeof session.subscription === "string") {
      subscription = await stripe.subscriptions.retrieve(session.subscription);
    } else {
      subscription = session.subscription;
    }
  }

  return withClient(async (client) => {
    let userId = await getUserIdByStripeCustomer(client, customerId);

    if (!userId && isUuid(metadataUserId)) {
      userId = metadataUserId;
    }

    let user = null;
    if (userId) {
      user = await getUserById(client, userId);
      if (!user) {
        await ensureUser(client, { id: userId, email: normalizedEmail });
        user = await getUserById(client, userId);
      } else if (user.email !== normalizedEmail) {
        await ensureUser(client, { id: user.id, email: normalizedEmail });
        user = await getUserById(client, user.id);
      }
    }

    if (!user) {
      user = await findOrCreateUserByEmail(client, normalizedEmail);
    }

    await upsertStripeCustomer(client, user.id, customerId);
    if (subscription && subscription.id) {
      await upsertEntitlement(client, {
        userId: user.id,
        email: String(user.email || normalizedEmail).toLowerCase(),
        subscription,
      });
    }

    return {
      id: String(user.id),
      email: String(user.email || normalizedEmail).toLowerCase(),
    };
  });
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

  const appJwtSecret = process.env.APP_JWT_SECRET;
  if (!appJwtSecret) {
    return json(500, { error: "Server misconfiguration: APP_JWT_SECRET is missing." });
  }

  const appUrl = normalizeBaseUrl(process.env.PUBLIC_APP_URL, "https://highspire.base44.app");

  try {
    if (!user) {
      const sessionId = body && typeof body.session_id === "string" ? body.session_id.trim() : "";
      if (!sessionId) {
        return json(401, {
          error: "Authentication required. Sign in or provide checkout session_id.",
        });
      }

      user = await resolveUserFromCheckoutSession(sessionId);
    } else {
      await withClient(async (client) => {
        await ensureUser(client, user);
      });
    }

    const token = jwt.sign(
      {
        user_id: String(user.id),
        email: String(user.email).toLowerCase(),
      },
      appJwtSecret,
      {
        expiresIn: "15m",
        issuer: "high-spire-site",
        audience: "high-spire-base44-app",
      }
    );

    const encodedToken = encodeURIComponent(token);
    return json(200, {
      token,
      app_url: `${appUrl}?token=${encodedToken}&access_token=${encodedToken}`,
    });
  } catch (err) {
    return json(500, {
      error: err && err.message ? err.message : "Unable to mint app token.",
    });
  }
};
