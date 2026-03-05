const { getBearerToken, getWebsiteUser, verifyAppToken } = require("./_lib/auth");
const { withClient, ensureUser } = require("./_lib/db");
const { json, methodNotAllowed, toIsoString } = require("./_lib/http");

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due", "canceled", "unpaid"]);

function normalizeStatus(status) {
  return ACTIVE_STATUSES.has(status) ? status : "inactive";
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
        return {
          email: user.email,
          plan: null,
          status: "inactive",
          current_period_end: null,
        };
      }

      return {
        email: row.email || user.email,
        plan: row.plan || null,
        status: normalizeStatus(row.status),
        current_period_end: toIsoString(row.current_period_end),
      };
    });

    return json(200, response);
  } catch (err) {
    return json(500, {
      error: err && err.message ? err.message : "Unable to fetch subscription status.",
    });
  }
};
