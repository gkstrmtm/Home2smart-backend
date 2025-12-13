import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const body = req.body;
    const { customer, cart } = body;

    if (!customer?.email || !cart?.length) {
      return res.status(400).json({ ok: false, error: 'Missing customer or cart' });
    }

    // Build Stripe line items
    const lineItems = cart.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.bundle_id || 'Service' },
        unit_amount: 14900 // $149
      },
      quantity: item.qty || 1
    }));

    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: customer.email,
      success_url: 'https://home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://home2smart.com/bundles'
    });

    // Insert order to database
    const orderRecord = {
      order_id: `order_${Date.now()}`,
      stripe_session_id: session.id,
      customer_email: customer.email,
      customer_name: customer.name || null,
      customer_phone: customer.phone || null,
      total: '149.00',
      currency: 'usd',
      items: JSON.stringify(cart),
      status: 'pending',
      created_at: new Date().toISOString()
    };

    const { data: insertedOrder, error: insertError } = await supabase
      .from('h2s_orders')
      .insert(orderRecord)
      .select()
      .single();

    return res.status(200).json({
      ok: true,
      pay: {
        session_url: session.url,
        session_id: session.id
      },
      debug: {
        order_created: !insertError,
        order_id: orderRecord.order_id,
        session_id: session.id,
        insert_error: insertError ? {
          message: insertError.message,
          code: insertError.code,
          details: insertError.details,
          hint: insertError.hint
        } : null,
        inserted_data: insertedOrder
      }
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack
    });
  }
}
