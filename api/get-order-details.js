import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { session_id, order_id } = req.query;

    if (!session_id && !order_id) {
      return res.status(400).json({ ok: false, error: 'Missing session_id or order_id parameter' });
    }

    // Initialize Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Fetch order from database
    let query = supabase
      .from('h2s_orders')
      .select('*');

    if (order_id) {
      query = query.eq('order_id', order_id);
    } else {
      query = query.eq('stripe_session_id', session_id);
    }

    const { data: order, error } = await query.single();

    if (error || !order) {
      console.error('[Get Order Details] Order not found:', error);
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Parse cart items from metadata
    let cartItems = [];
    try {
      const metadata = order.metadata || {};
      if (metadata.cart_items) {
        cartItems = JSON.parse(metadata.cart_items);
      }
    } catch (err) {
      console.error('[Get Order Details] Failed to parse cart items:', err);
    }

    // Build order summary
    const orderSummary = cartItems.map(item => {
      const qty = item.qty || 1;
      const name = item.name || item.id || 'Item';
      return `${qty}× ${name}`;
    }).join(' | ') || 'N/A';

    // Calculate totals
    const amountTotal = order.amount_total ? (order.amount_total / 100).toFixed(2) : '0.00';
    const currency = (order.currency || 'usd').toUpperCase();

    // Return formatted order details
    return res.status(200).json({
      ok: true,
      order: {
        order_id: order.order_id,
        stripe_session_id: order.stripe_session_id,
        customer_name: order.customer_name || '',
        customer_email: order.customer_email || '',
        customer_phone: order.customer_phone || '',
        amount_total: amountTotal,
        currency: currency,
        status: order.status,
        delivery_date: order.delivery_date,
        delivery_time: order.delivery_time,
        created_at: order.created_at,
        items: cartItems,
        item_count: cartItems.length,
        order_summary: orderSummary,
        discount_code: order.metadata?.promotion_code || '',
        metadata: order.metadata
      }
    });

  } catch (err) {
    console.error('[Get Order Details] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
