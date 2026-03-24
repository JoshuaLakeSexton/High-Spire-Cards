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

    return json(200, {
      token,
      app_url: `${appUrl}?token=${encodeURIComponent(token)}`,
    });
  } catch (err) {
    return json(500, {
      error: err && err.message ? err.message : "Unable to mint app token.",
    });
  }
};
