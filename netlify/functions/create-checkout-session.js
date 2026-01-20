const Stripe = require("stripe");

exports.handler = async function () {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PRICE_ID;
    const siteUrl = process.env.URL || "http://localhost:8888";

    if (!secretKey || !priceId) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Missing STRIPE_SECRET_KEY or STRIPE_PRICE_ID in Netlify environment variables."
        })
      };
    }

    const stripe = new Stripe(secretKey);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/success`,
      cancel_url: `${siteUrl}/cancel`
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
