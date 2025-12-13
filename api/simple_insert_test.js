/**
 * Direct SQL insert test order (bypass Supabase client issues)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const testOrderId = `test-order-${Date.now()}`;
    const now = new Date().toISOString();
    
    // Use raw SQL to bypass schema cache issues
    const { data, error } = await supabase.rpc('exec_sql', {
      sql_query: `
        INSERT INTO h2s_orders (
          order_id, session_id, customer_email, service_id, option_id, qty, line_type, created_at
        ) VALUES 
        ('${testOrderId}', 'test-session', 'test@example.com', 'test-service-1', 'test-option-1', 2, 'summary', '${now}'),
        ('${testOrderId}', 'test-session', 'test@example.com', 'test-service-1', 'test-option-1', 2, 'service', '${now}')
        RETURNING *;
      `
    });

    if (error) {
      // RPC might not exist, try direct insert via SQL
      const { data: insertData, error: insertError } = await supabase
        .from('h2s_orders')
        .insert([
          {
            order_id: testOrderId,
            session_id: 'test-session-' + Date.now(),
            customer_email: 'test@example.com',
            service_id: 'test-svc',
            option_id: 'test-opt',
            qty: 2,
            line_type: 'summary'
          }
        ])
        .select();

      if (insertError) {
        return res.status(400).json({ ok: false, error: insertError.message, details: insertError });
      }

      return res.status(200).json({ ok: true, order_id: testOrderId, rows: insertData });
    }

    return res.status(200).json({ ok: true, order_id: testOrderId, rows: data });

  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, stack: error.stack });
  }
}
