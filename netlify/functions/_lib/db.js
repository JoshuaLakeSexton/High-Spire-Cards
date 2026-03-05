const { Pool } = require("pg");

let pool;
const DB_ERROR_PATTERNS = [
  "database_url",
  "password authentication failed",
  "connect",
  "connection terminated",
  "econnrefused",
  "timeout",
  "no pg_hba.conf entry",
];

function shouldUseSsl(connectionString) {
  if (!connectionString) {
    return false;
  }

  return !/localhost|127\.0\.0\.1/i.test(connectionString);
}

function getPool() {
  if (pool) {
    return pool;
  }

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error(
      "Server misconfiguration: DATABASE_URL (or NETLIFY_DATABASE_URL) is missing."
    );
  }

  pool = new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });

  return pool;
}

function isDatabaseConnectivityError(err) {
  const message = err && err.message ? String(err.message).toLowerCase() : "";
  return DB_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

async function withClient(callback) {
  const client = await getPool().connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

async function ensureUser(client, user) {
  const result = await client.query(
    `
      INSERT INTO users (id, email)
      VALUES ($1::uuid, $2)
      ON CONFLICT (id)
      DO UPDATE SET email = EXCLUDED.email
      RETURNING id, email
    `,
    [user.id, user.email.toLowerCase()]
  );

  return result.rows[0];
}

async function findUserByEmail(client, email) {
  const result = await client.query(`SELECT id, email FROM users WHERE email = $1 LIMIT 1`, [
    email.toLowerCase(),
  ]);
  return result.rows[0] || null;
}

async function findOrCreateUserByEmail(client, email) {
  const existing = await findUserByEmail(client, email);
  if (existing) {
    return existing;
  }

  const result = await client.query(
    `
      INSERT INTO users (email)
      VALUES ($1)
      ON CONFLICT (email)
      DO UPDATE SET email = EXCLUDED.email
      RETURNING id, email
    `,
    [email.toLowerCase()]
  );

  return result.rows[0];
}

async function getUserById(client, userId) {
  const result = await client.query(`SELECT id, email FROM users WHERE id = $1::uuid LIMIT 1`, [userId]);
  return result.rows[0] || null;
}

async function getStripeCustomerForUser(client, userId) {
  const result = await client.query(
    `SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1::uuid`,
    [userId]
  );
  return result.rows[0] ? result.rows[0].stripe_customer_id : null;
}

async function getUserIdByStripeCustomer(client, stripeCustomerId) {
  const result = await client.query(
    `SELECT user_id FROM stripe_customers WHERE stripe_customer_id = $1 LIMIT 1`,
    [stripeCustomerId]
  );
  return result.rows[0] ? result.rows[0].user_id : null;
}

async function upsertStripeCustomer(client, userId, stripeCustomerId) {
  await client.query(
    `
      INSERT INTO stripe_customers (user_id, stripe_customer_id)
      VALUES ($1::uuid, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id
    `,
    [userId, stripeCustomerId]
  );
}

module.exports = {
  getPool,
  isDatabaseConnectivityError,
  withClient,
  ensureUser,
  findUserByEmail,
  findOrCreateUserByEmail,
  getUserById,
  getStripeCustomerForUser,
  getUserIdByStripeCustomer,
  upsertStripeCustomer,
};
