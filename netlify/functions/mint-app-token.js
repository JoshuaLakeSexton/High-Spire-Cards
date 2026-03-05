const Stripe = require("stripe");
const jwt = require("jsonwebtoken");
const { getWebsiteUser } = require("./_lib/auth");
const {
  withClient,
  ensureUser,
  getUserById,
  getUserIdByStripeCustomer,
  findOrCreateUserByEmail,
  upsertStripeCustomer,
} = require("./_lib/db");
const { json, methodNotAllowed, normalizeBaseUrl, parseJsonBody } = require("./_lib/http");

function getSessionCustomerId(session) {
  if (!session || !session.customer) {
    return "";
  }

  if (typeof session.customer === "string") {
    return session.customer;
  }

  return session.customer.id || "";
}

function getSessionEmail(session) {
  if (!session) {
    return "";
  }

  const directEmail =
    (session.customer_details && session.customer_details.email) ||
    session.customer_email ||
    (session.customer && typeof session.customer === "object" ? session.customer.email : "");

  return typeof directEmail === "string" ? directEmail.trim().toLowerCase() : "";
}

function normalizeUserRecord(row) {
  return {
    id: String(row.id),
    email: String(row.email).toLowerCase(),
  };
}

async function resolveUserFromSession(sessionId, stripe) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["customer"],
  });

  if (!session) {
    const err = new Error("Stripe checkout session not found.");
    err.statusCode = 404;
    throw err;
  }

  if (session.mode !== "subscription") {
    const err = new Error("Checkout session is not a subscription session.");
    err.statusCode = 400;
    throw err;
  }

  if (session.status !== "complete") {
    const err = new Error("Checkout session is not complete yet.");
    err.statusCode = 409;
    throw err;
  }

  const metadataUserId =
    session.metadata && typeof session.metadata.user_id === "string"
      ? session.metadata.user_id.trim()
      : "";
  const customerId = getSessionCustomerId(session);
  const email = getSessionEmail(session);

  const user = await withClient(async (client) => {
    let row = null;

    if (metadataUserId) {
      row = await getUserById(client, metadataUserId);
      if (!row) {
        if (!email) {
          const err = new Error("Unable to resolve checkout user email.");
          err.statusCode = 400;
          throw err;
        }
        row = await ensureUser(client, { id: metadataUserId, email });
      } else if (email && row.email.toLowerCase() !== email) {
        row = await ensureUser(client, { id: row.id, email });
      }
    }

    if (!row && customerId) {
      const mappedUserId = await getUserIdByStripeCustomer(client, customerId);
      if (mappedUserId) {
        row = await getUserById(client, mappedUserId);
      }
    }

    if (!row) {
      if (!email) {
        const err = new Error("Unable to resolve user for checkout session.");
        err.statusCode = 400;
        throw err;
      }
      row = await findOrCreateUserByEmail(client, email);
    }

    if (customerId) {
      await upsertStripeCustomer(client, row.id, customerId);
    }

    return normalizeUserRecord(row);
  });

  return user;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowed();
  }

  const body = parseJsonBody(event);
  if (body === null) {
    return json(400, { error: "Invalid JSON body." });
  }

  const websiteUser = getWebsiteUser(event);
  const appJwtSecret = process.env.APP_JWT_SECRET;
  const appUrl = normalizeBaseUrl(process.env.PUBLIC_APP_URL, "https://app.base44.com");
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!appJwtSecret) {
    return json(500, { error: "Server misconfiguration: APP_JWT_SECRET is missing." });
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!websiteUser && !sessionId) {
    return json(401, {
      error: "Authentication required. Provide a valid session_id or sign in.",
    });
  }

  if (!websiteUser && !stripeSecret) {
    return json(500, { error: "Server misconfiguration: STRIPE_SECRET_KEY is missing." });
  }

  try {
    let user = websiteUser;
    if (!user) {
      const stripe = new Stripe(stripeSecret);
      user = await resolveUserFromSession(sessionId, stripe);
    }

    await withClient(async (client) => {
      await ensureUser(client, user);
    });

    const token = jwt.sign(
      {
        user_id: user.id,
        email: user.email,
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
    return json(err.statusCode || 500, { error: err.message || "Unable to mint app token." });
  }
};
