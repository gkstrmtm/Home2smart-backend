/**
 * Create test order in h2s_orders for migration testing
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const testOrderId = `test-order-${Date.now()}`;
    const testSessionId = `test-session-${Date.now()}`;

    // Create test order matching shop.js structure exactly
    const now = new Date().toISOString();
    const orderRows = [
      // Summary row
      {
        order_id: testOrderId,
        session_id: testSessionId,
        mode: 'payment',
        status: 'pending',
        created_at: now,
        customer_email: 'test@greenwood.com',
        name: 'Greenwood Test Customer',
        phone: '864-555-0100',
        source: '/admin-test',
        currency: 'usd',
        cart_json: JSON.stringify([{ 
          type: 'service', 
          service_id: 'security-cameras', 
          option_id: '2-camera-install', 
          name: 'Security Camera Installation',
          qty: 2,
          price: 199.99
        }]),
        line_type: 'summary',
        line_index: null,
        service_id: null,
        option_id: null,
        bundle_id: null,
        qty: null,
        service_address: '123 Main Street',
        service_city: 'Greenwood',
        service_state: 'SC',
        service_zip: '29646',
        subtotal: 399.98,
        total_price: 399.98
      },
      // Line item row
      {
        order_id: testOrderId,
        session_id: testSessionId,
        mode: 'payment',
        status: 'pending',
        created_at: now,
        customer_email: 'test@greenwood.com',
        name: 'Greenwood Test Customer',
        phone: '864-555-0100',
        source: '/admin-test',
        currency: 'usd',
        cart_json: '',
        line_type: 'service',
        line_index: 0,
        service_id: 'security-cameras',
        option_id: '2-camera-install',
        bundle_id: null,
        qty: 2,
        service_address: '123 Main Street',
        service_city: 'Greenwood',
        service_state: 'SC',
        service_zip: '29646',
        subtotal: 399.98,
        total_price: 399.98
      }
    ];

    const { data: insertedOrders, error: insertError } = await supabase
      .from('h2s_orders')
      .insert(orderRows)
      .select();

    if (insertError) {
      return res.status(500).json({
        ok: false,
        error: insertError.message
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'Test order created in Greenwood, SC',
      order_id: testOrderId,
      customer: 'Greenwood Test Customer',
      address: '123 Main Street, Greenwood, SC 29646',
      service: 'Security Camera Installation (2x)',
      total_price: 399.98,
      rows_inserted: insertedOrders.length,
      next_step: 'Run migration: GET /api/create_jobs_from_orders to create dispatch job'
    });

  } catch (error) {
    console.error('[create_test_order] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
