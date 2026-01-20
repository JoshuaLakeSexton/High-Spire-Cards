const Stripe = require("stripe");\
\
exports.handler = async (event) => \{\
  if (event.httpMethod !== "POST") \{\
    return \{ statusCode: 405, body: "Method Not Allowed" \};\
  \}\
\
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;\
  const priceId = process.env.STRIPE_PRICE_ID;\
  const siteUrl = process.env.SITE_URL; // set to https://highspirecards.com in Netlify env vars\
\
  if (!stripeSecretKey || !priceId || !siteUrl) \{\
    return \{\
      statusCode: 500,\
      body: "Missing STRIPE_SECRET_KEY, STRIPE_PRICE_ID, or SITE_URL environment variables."\
    \};\
  \}\
\
  const stripe = new Stripe(stripeSecretKey, \{ apiVersion: "2024-06-20" \});\
\
  try \{\
    const session = await stripe.checkout.sessions.create(\{\
      mode: "subscription",\
      line_items: [\{ price: priceId, quantity: 1 \}],\
      success_url: `$\{siteUrl\}/success?session_id=\{CHECKOUT_SESSION_ID\}`,\
      cancel_url: `$\{siteUrl\}/cancel`\
    \});\
\
    return \{\
      statusCode: 200,\
      headers: \{ "Content-Type": "application/json" \},\
      body: JSON.stringify(\{ url: session.url \})\
    \};\
  \} catch (err) \{\
    return \{ statusCode: 500, body: err.message || "Stripe error" \};\
  \}\
\};\
}
