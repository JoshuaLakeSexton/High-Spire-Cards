const Stripe = require("stripe");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;

    if (!secretKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing STRIPE_SECRET_KEY" }) };
    }
    if (!priceId) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing STRIPE_PRICE_ID" }) };
    }

    const stripe = new Stripe(secretKey);

    // Create customer first (works around your Accounts v2 restriction)
    const customer = await stripe.customers.create();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],

      // 3-day free trial (optional — keep or remove)
      subscription_data: { trial_period_days: 3 },

      // collect payment method up front so it can charge after trial
      payment_method_collection: "always",

      success_url: "https://highspirecards.com/thanks.html",
      cancel_url: "https://highspirecards.com/",
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Server error" }),
    };
  }
};
