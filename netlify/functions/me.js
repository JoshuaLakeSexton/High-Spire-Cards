const { getBearerToken, getWebsiteUser, verifyAppToken } = require("./_lib/auth");
const { withClient, ensureUser } = require("./_lib/db");
const { json, methodNotAllowed, optionsResponse, toIsoString } = require("./_lib/http");

const KNOWN_STATUSES = new Set(["active", "trialing", "past_due", "canceled", "unpaid"]);

function normalizeStatus(status) {
  return KNOWN_STATUSES.has(status) ? status : "inactive";
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
  const websiteUser = getWebsiteUser(event);
  const bearer = getBearerToken(event);

  if (!bearer) {
    return websiteUser;
  }

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
  if (event.httpMethod === "OPTIONS") {
    return optionsResponse();
  }

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
    return json(err.statusCode || 401, { error: err.message || "Authentication failed." });
  }

  try {
    const response = await withClient(async (client) => {
      await ensureUser(client, user);
      const entitlement = await getEntitlement(client, user.id);

      if (!entitlement) {
        return {
          email: user.email,
          plan: null,
          status: "inactive",
          current_period_end: null,
        };
      }

      return {
        email: entitlement.email || user.email,
        plan: entitlement.plan || null,
        status: normalizeStatus(entitlement.status),
        current_period_end: toIsoString(entitlement.current_period_end),
      };
    });

    return json(200, response);
  } catch (err) {
    return json(500, {
      error: err && err.message ? err.message : "Unable to fetch subscription status.",
    });
  }
};
