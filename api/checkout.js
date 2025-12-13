import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS headers
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only support POST
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { customer, cart, source } = req.body;

    console.log('[Checkout] Creating session for:', customer?.email);
    console.log('[Checkout] Cart items:', cart?.length);

    // Validate input
    if (!customer?.email) {
      return res.status(400).json({ ok: false, error: 'Customer email required' });
    }

    if (!cart || cart.length === 0) {
      return res.status(400).json({ ok: false, error: 'Cart is empty' });
    }

    // Generate order ID
    const orderId = generateOrderId();

    // Build line items from cart
    const lineItems = [];

    for (const item of cart) {
      if (item.type === 'bundle') {
        // Look up bundle in database
        const { data: bundle, error } = await supabase
          .from('h2s_bundles')
          .select('*')
          .eq('bundle_id', item.bundle_id)
          .single();

        if (error || !bundle) {
          console.error('[Checkout] Bundle not found:', item.bundle_id);
          return res.status(400).json({
            ok: false,
            error: `Bundle not found: ${item.bundle_id}`
          });
        }

        if (!bundle.stripe_price_id) {
          console.error('[Checkout] Bundle missing stripe_price_id:', item.bundle_id);
          return res.status(400).json({
            ok: false,
            error: `Bundle ${item.bundle_id} not configured for checkout`
          });
        }

        lineItems.push({
          price: bundle.stripe_price_id,
          quantity: item.qty || 1
        });

      } else if (item.service_id) {
        // Look up service pricing tier
        const { data: tier, error } = await supabase
          .from('h2s_pricetiers')
          .select('*')
          .eq('service_id', item.service_id)
          .lte('min_qty', item.qty || 1)
          .gte('max_qty', item.qty || 1)
          .single();

        if (error || !tier || !tier.stripe_price_id) {
          console.error('[Checkout] No pricing tier for:', item.service_id, 'qty:', item.qty);
          return res.status(400).json({
            ok: false,
            error: `No pricing available for ${item.service_id} (qty: ${item.qty})`
          });
        }

        lineItems.push({
          price: tier.stripe_price_id,
          quantity: 1 // Tier already includes qty
        });
      }
    }

    if (lineItems.length === 0) {
      return res.status(400).json({ ok: false, error: 'No valid items in cart' });
    }

    // Create Stripe checkout session
    const sessionParams = {
      mode: 'payment',
      line_items: lineItems,
      customer_email: customer.email,
      success_url: `${process.env.FRONTEND_URL || 'https://home2smart.com'}/shop?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://home2smart.com'}/shop?back=1`,
      metadata: {
        source: source || '/shop',
        order_id: orderId,
        customer_name: customer.name || '',
        customer_phone: customer.phone || ''
      },
      allow_promotion_codes: true
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    console.log('[Checkout] Session created:', session.id);

    // Save order to database
    try {
      const { error: orderError } = await supabase
        .from('h2s_orders')
        .insert({
          order_id: orderId,
          session_id: session.id,
          email: customer.email,
          name: customer.name || '',
          phone: customer.phone || '',
          status: 'pending',
          source: source || '/shop',
          cart: cart,
          created_at: new Date().toISOString()
        });

      if (orderError) {
        console.error('[Checkout] Failed to save order:', orderError);
        // Don't fail checkout - order can be recovered from Stripe webhook
      }
    } catch (dbErr) {
      console.error('[Checkout] Database error:', dbErr);
    }

    return res.status(200).json({
      ok: true,
      pay: {
        session_url: session.url,
        session_id: session.id
      }
    });

  } catch (error) {
    console.error('[Checkout] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Checkout failed'
    });
  }
}

function generateOrderId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 7);
  return `order_${timestamp}_${random}`;
}
