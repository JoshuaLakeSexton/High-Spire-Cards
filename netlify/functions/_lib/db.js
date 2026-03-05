const { Pool } = require("pg");

let pool;

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

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Server misconfiguration: DATABASE_URL is missing.");
  }

  pool = new Pool({
    connectionString,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });

  return pool;
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

async function getStripeCustomerForUser(client, userId) {
  const result = await client.query(
    `SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1::uuid`,
    [userId]
  );
  return result.rows[0] ? result.rows[0].stripe_customer_id : null;
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
  withClient,
  ensureUser,
  getStripeCustomerForUser,
  upsertStripeCustomer,
};
