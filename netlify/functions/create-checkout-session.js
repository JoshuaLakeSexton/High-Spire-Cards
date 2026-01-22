import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const price = process.env.STRIPE_PRICE_ID;
    if (!price) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing STRIPE_PRICE_ID" }) };
    }

    // Create an “existing customer” (works around your Accounts v2 restriction)
    const customer = await stripe.customers.create();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price, quantity: 1 }],
      success_url: "https://highspirecards.com/thanks.html",
      cancel_url: "https://highspirecards.com/",
    });
const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [{ price, quantity: 1 }],

  // 3-day free trial
  subscription_data: {
    trial_period_days: 3,
  },

  // Collect payment method up front so Stripe can charge automatically when trial ends
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
}
