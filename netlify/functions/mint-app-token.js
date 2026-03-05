const jwt = require("jsonwebtoken");
const { requireWebsiteUser } = require("./_lib/auth");
const { withClient, ensureUser } = require("./_lib/db");
const { json, methodNotAllowed, normalizeBaseUrl } = require("./_lib/http");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowed();
  }

  let websiteUser;
  try {
    websiteUser = requireWebsiteUser(event);
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || "Authentication required." });
  }

  const appJwtSecret = process.env.APP_JWT_SECRET;
  const appUrl = normalizeBaseUrl(process.env.PUBLIC_APP_URL, "https://app.base44.com");
  if (!appJwtSecret) {
    return json(500, { error: "Server misconfiguration: APP_JWT_SECRET is missing." });
  }

  try {
    await withClient(async (client) => {
      await ensureUser(client, websiteUser);
    });

    const token = jwt.sign(
      {
        user_id: websiteUser.id,
        email: websiteUser.email,
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
