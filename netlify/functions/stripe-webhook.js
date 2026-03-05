const Stripe = require("stripe");
const { withClient, ensureUser, upsertStripeCustomer } = require("./_lib/db");
const { getHeader } = require("./_lib/auth");
const { json, methodNotAllowed } = require("./_lib/http");

const SUPPORTED_SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

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
  return new Date(seconds * 1000);
}

async function getUserIdFromStripeCustomer(client, stripeCustomerId) {
  const result = await client.query(
    `SELECT user_id FROM stripe_customers WHERE stripe_customer_id = $1 LIMIT 1`,
    [stripeCustomerId]
  );
  return result.rows[0] ? result.rows[0].user_id : null;
}

async function upsertEntitlement(client, { userId, subscription }) {
  await client.query(
    `
      INSERT INTO entitlements (
        user_id,
        plan,
        status,
        current_period_end,
        stripe_subscription_id,
        updated_at
      )
      VALUES (
        $1::uuid,
        'pro',
        $2,
        $3,
        $4,
        now()
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        plan = EXCLUDED.plan,
        status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        updated_at = now()
    `,
    [
      userId,
      normalizeStatus(subscription.status),
      toTimestamp(subscription.current_period_end),
      subscription.id,
    ]
  );
}

async function processCheckoutSessionCompleted(client, stripe, session) {
  const userId = session.metadata && session.metadata.user_id;
  const customerId = typeof session.customer === "string" ? session.customer : null;
  const email = session.customer_details && session.customer_details.email;

  if (!userId || !customerId || !email) {
    return;
  }

  await ensureUser(client, { id: userId, email: email.toLowerCase() });
  await upsertStripeCustomer(client, userId, customerId);

  const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
  if (!subscriptionId) {
    return;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await upsertEntitlement(client, { userId, subscription });
}

async function processSubscriptionEvent(client, subscription) {
  const stripeCustomerId = typeof subscription.customer === "string" ? subscription.customer : null;
  if (!stripeCustomerId) {
    return;
  }

  const userId = await getUserIdFromStripeCustomer(client, stripeCustomerId);
  if (!userId) {
    return;
  }

  await upsertEntitlement(client, { userId, subscription });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowed();
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey) {
    return json(500, { error: "Server misconfiguration: STRIPE_SECRET_KEY is missing." });
  }
  if (!webhookSecret) {
    return json(500, { error: "Server misconfiguration: STRIPE_WEBHOOK_SECRET is missing." });
  }

  const signature = getHeader(event, "stripe-signature");
  if (!signature) {
    return json(400, { error: "Missing Stripe signature header." });
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64")
    : Buffer.from(event.body || "", "utf8");

  const stripe = new Stripe(secretKey);
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return json(400, { error: `Invalid webhook signature: ${err.message}` });
  }

  try {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const inserted = await client.query(
          `
            INSERT INTO stripe_event_logs (event_id, event_type)
            VALUES ($1, $2)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id
          `,
          [stripeEvent.id, stripeEvent.type]
        );

        if (inserted.rowCount === 0) {
          await client.query("ROLLBACK");
          return;
        }

        if (stripeEvent.type === "checkout.session.completed") {
          await processCheckoutSessionCompleted(client, stripe, stripeEvent.data.object);
        } else if (SUPPORTED_SUBSCRIPTION_EVENTS.has(stripeEvent.type)) {
          await processSubscriptionEvent(client, stripeEvent.data.object);
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });

    return json(200, { received: true });
  } catch (err) {
    return json(500, { error: err && err.message ? err.message : "Webhook processing failed." });
  }
};
