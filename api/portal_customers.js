import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/portal_customers
 * Returns customers for pro to call (appointments, quotes, leads)
 * 
 * Requires: Bearer token (pro_id from portal session)
 */
export default async function handler(req, res) {
  // CORS headers
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
    // Get pro_id from Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: 'Missing auth token' });
    }

    const token = authHeader.substring(7);
    
    // Validate session and get pro_id
    const { data: session, error: sessionError } = await supabase
      .from('h2s_sessions')
      .select('pro_id')
      .eq('session_id', token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (sessionError || !session) {
      console.error('[portal_customers] Invalid session:', sessionError);
      return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
    }

    const pro_id = session.pro_id;
    console.log(`[portal_customers] Fetching customers for pro: ${pro_id}`);

    // Query upcoming appointments assigned to this pro
    const { data: appointments, error: apptError } = await supabase.rpc('get_pro_customers', {
      p_pro_id: pro_id
    });

    if (apptError) {
      console.error('[portal_customers] Query failed:', apptError);
      return res.status(500).json({ ok: false, error: apptError.message });
    }

    console.log(`[portal_customers] Found ${appointments?.length || 0} customers`);

    return res.json({
      ok: true,
      customers: appointments || []
    });

  } catch (error) {
    console.error('[portal_customers] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
