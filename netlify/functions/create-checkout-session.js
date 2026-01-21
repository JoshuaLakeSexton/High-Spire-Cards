import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const price = process.env.STRIPE_PRICE_ID;
    if (!price) return { statusCode: 500, body: "Missing STRIPE_PRICE_ID" };

    // Create an “existing customer” every time (simple fix)
    const customer = await stripe.customers.create();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price, quantity: 1 }],
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
