import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const testOrder = {
    order_id: `test_${Date.now()}`,
    stripe_session_id: `test_session_${Date.now()}`,
    customer_email: 'test@insert.com',
    total: 100,
    currency: 'usd',
    items: JSON.stringify([{name: 'test'}]),
    status: 'pending'
  };

  const { data, error } = await supabase
    .from('h2s_orders')
    .insert(testOrder)
    .select()
    .single();

  if (error) {
    return res.status(500).json({
      ok: false,
      error: error.message,
      details: error,
      attempted_columns: Object.keys(testOrder)
    });
  }

  return res.status(200).json({
    ok: true,
    message: 'Insert successful',
    inserted_order: data
  });
}
