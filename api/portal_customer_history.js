// =====================================================
// GET /api/portal_customer_history
// Returns all past customers for a pro (completed jobs)
// =====================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      return res.status(401).json({ ok: false, error: 'No token provided' });
    }

    // Validate session and get pro_id
    const { data: sessionData, error: sessionError } = await supabase
      .from('h2s_sessions')
      .select('pro_id')
      .eq('session_id', token)
      .single();

    if (sessionError || !sessionData) {
      return res.status(401).json({ ok: false, error: 'Invalid session' });
    }

    const { pro_id } = sessionData;

    // Call PostgreSQL function to get customer history
    const { data: customers, error: customersError } = await supabase.rpc(
      'get_pro_customer_history',
      { p_pro_id: pro_id }
    );

    if (customersError) {
      console.error('[portal_customer_history] Query error:', customersError);
      return res.status(500).json({ ok: false, error: 'Failed to load customer history' });
    }

    return res.status(200).json({
      ok: true,
      customers: customers || []
    });

  } catch (err) {
    console.error('[portal_customer_history] Error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}
