/**
 * Simulate a complete checkout without Stripe
 * Creates order rows in h2s_orders exactly like shop.js does after payment
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // Use service role to bypass RLS
);

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const orderId = `sim-order-${Date.now()}`;
    const sessionId = `sim-session-${Date.now()}`;
    const now = new Date().toISOString();

    // Simulate a cart with 2 items
    const cart = [
      {
        type: 'service',
        service_id: 'hvac-repair',
        option_id: 'standard-hvac',
        qty: 1,
        service_name: 'HVAC Repair',
        option_name: 'Standard Service'
      },
      {
        type: 'service',
        service_id: 'plumbing',
        option_id: 'emergency-plumbing',
        qty: 1,
        service_name: 'Plumbing',
        option_name: 'Emergency Service'
      }
    ];

    // Build order rows - MINIMAL columns only
    const orderRows = [];
    
    // Summary row
    orderRows.push({
      order_id: orderId,
      session_id: sessionId,
      customer_email: 'simulated@example.com',
      line_type: 'summary',
      cart_json: JSON.stringify(cart)
    });
    
    // Line item rows
    cart.forEach((item, idx) => {
      orderRows.push({
        order_id: orderId,
        session_id: sessionId,
        customer_email: 'simulated@example.com',
        line_type: 'service',
        service_id: item.service_id,
        option_id: item.option_id,
        qty: item.qty
      });
    });

    // Insert exactly like shop.js does
    const { data: insertedRows, error: insertError } = await supabase
      .from('h2s_orders')
      .insert(orderRows)
      .select();

    if (insertError) {
      console.error('[simulate_checkout] Insert failed:', insertError);
      return res.status(500).json({
        ok: false,
        error: insertError.message,
        details: insertError
      });
    }

    console.log('[simulate_checkout] Order saved with', orderRows.length, 'rows');

    return res.status(200).json({
      ok: true,
      message: 'Simulated checkout complete',
      order_id: orderId,
      customer_email: 'simulated@example.com',
      items_count: cart.length,
      total_rows: insertedRows.length,
      cart: cart,
      note: 'Now click "Sync Orders → Jobs" in admin portal'
    });

  } catch (error) {
    console.error('[simulate_checkout] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack
    });
  }
}
