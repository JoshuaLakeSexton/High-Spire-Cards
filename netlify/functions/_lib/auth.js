const jwt = require("jsonwebtoken");

function getHeader(event, key) {
  if (!event || !event.headers) {
    return "";
  }

  return event.headers[key] || event.headers[key.toLowerCase()] || "";
}

function getBearerToken(event) {
  const raw = getHeader(event, "authorization");
  if (!raw || typeof raw !== "string") {
    return "";
  }

  const [scheme, token] = raw.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return "";
  }

  return token.trim();
}

function getWebsiteUser(event) {
  const contextUser = event && event.clientContext && event.clientContext.user;
  if (contextUser && contextUser.sub && contextUser.email) {
    return {
      id: String(contextUser.sub),
      email: String(contextUser.email).toLowerCase(),
      source: "identity",
    };
  }

  const headerUserId = getHeader(event, "x-user-id");
  const headerEmail = getHeader(event, "x-user-email");
  if (headerUserId && headerEmail) {
    return {
      id: String(headerUserId),
      email: String(headerEmail).toLowerCase(),
      source: "headers",
    };
  }

  return null;
}

function requireWebsiteUser(event) {
  const user = getWebsiteUser(event);
  if (!user) {
    const err = new Error("Authentication required. Please sign in and try again.");
    err.statusCode = 401;
    throw err;
  }

  return user;
}

function verifyAppToken(event) {
  const token = getBearerToken(event);
  if (!token) {
    return null;
  }

  const secret = process.env.APP_JWT_SECRET || process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    const err = new Error(
      "Server misconfiguration: APP_JWT_SECRET (or STRIPE_SECRET_KEY fallback) is missing."
    );
    err.statusCode = 500;
    throw err;
  }

  try {
    const payload = jwt.verify(token, secret);
    if (!payload || !payload.user_id || !payload.email) {
      const err = new Error("Invalid token payload.");
      err.statusCode = 401;
      throw err;
    }

    return {
      id: String(payload.user_id),
      email: String(payload.email).toLowerCase(),
      source: "app_jwt",
    };
  } catch (err) {
    const wrapped = new Error("Invalid or expired token.");
    wrapped.statusCode = 401;
    wrapped.cause = err;
    throw wrapped;
  }
}

module.exports = {
  getHeader,
  getBearerToken,
  getWebsiteUser,
  requireWebsiteUser,
  verifyAppToken,
};
