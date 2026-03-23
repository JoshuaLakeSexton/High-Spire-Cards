const jwt = require("jsonwebtoken");
const { requireWebsiteUser } = require("./_lib/auth");
const { withClient, ensureUser } = require("./_lib/db");
const { json, methodNotAllowed, normalizeBaseUrl, optionsResponse } = require("./_lib/http");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return optionsResponse();
  }

  if (event.httpMethod !== "POST") {
    return methodNotAllowed();
  }

  let user;
  try {
    user = requireWebsiteUser(event);
  } catch (err) {
    return json(err.statusCode || 401, { error: err.message || "Authentication required." });
  }

  const appJwtSecret = process.env.APP_JWT_SECRET;
  if (!appJwtSecret) {
    return json(500, { error: "Server misconfiguration: APP_JWT_SECRET is missing." });
  }

  const appUrl = normalizeBaseUrl(process.env.PUBLIC_APP_URL, "https://app.base44.com");

  try {
    await withClient(async (client) => {
      await ensureUser(client, user);
    });

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
