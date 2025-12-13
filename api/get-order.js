import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Get order details by order_id
 * Used by schedule.html to display customer info
 */
export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const orderId = req.query.order_id || req.query.session_id;

    if (!orderId) {
      return res.status(400).json({ ok: false, error: 'Missing order_id parameter' });
    }

    // Query by UUID (id) or stripe_session_id
    let query = supabase.from('h2s_orders').select('*');
    
    // Try UUID first
    if (orderId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      query = query.eq('id', orderId);
    } else {
      // Assume it's a Stripe session ID
      query = query.eq('stripe_session_id', orderId);
    }

    const { data: order, error } = await query.single();

    if (error || !order) {
      console.error('[GetOrder] Not found:', orderId);
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Return sanitized order data
    return res.json({
      ok: true,
      order_id: order.id,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      service_name: order.service_name,
      amount_total: order.amount_total,
      delivery_date: order.delivery_date,
      delivery_time: order.delivery_time
    });

  } catch (error) {
    console.error('[GetOrder] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
