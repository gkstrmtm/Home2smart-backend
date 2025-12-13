import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /api/portal_log_call
 * Logs a pro → customer call
 * 
 * Body:
 *   customer_phone, customer_email, customer_name, order_id,
 *   call_reason, call_outcome, notes, follow_up_date
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Get pro_id from Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: 'Missing auth token' });
    }

    const token = authHeader.substring(7);
    
    // Validate session
    const { data: session, error: sessionError } = await supabase
      .from('h2s_sessions')
      .select('pro_id')
      .eq('session_id', token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (sessionError || !session) {
      return res.status(401).json({ ok: false, error: 'Invalid session' });
    }

    const pro_id = session.pro_id;

    // Parse request body
    const {
      customer_phone,
      customer_email,
      customer_name,
      order_id,
      call_reason,
      call_outcome,
      notes,
      follow_up_date
    } = req.body;

    // Validation
    if (!customer_phone || !call_reason || !call_outcome) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required fields: customer_phone, call_reason, call_outcome' 
      });
    }

    console.log(`[portal_log_call] Logging call: ${pro_id} → ${customer_phone} (${call_outcome})`);

    // Insert call log
    const { data: log, error: logError } = await supabase
      .from('h2s_call_logs')
      .insert({
        pro_id,
        customer_phone,
        customer_email: customer_email || null,
        customer_name: customer_name || null,
        order_id: order_id || null,
        call_reason,
        call_outcome,
        notes: notes || null,
        follow_up_date: follow_up_date || null
      })
      .select()
      .single();

    if (logError) {
      console.error('[portal_log_call] Insert failed:', logError);
      return res.status(500).json({ ok: false, error: logError.message });
    }

    console.log(`[portal_log_call] ✅ Call logged: ${log.log_id}`);

    return res.json({
      ok: true,
      log_id: log.log_id,
      message: 'Call logged successfully'
    });

  } catch (error) {
    console.error('[portal_log_call] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
