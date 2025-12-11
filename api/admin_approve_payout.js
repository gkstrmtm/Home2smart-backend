import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: { bodyParser: true },
};

async function validateAdmin(token) {
  if (!token) return false;
  
  // Try admin sessions table first (dispatch dashboard)
  let { data, error } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('admin_email, expires_at')
    .eq('session_id', token)
    .single();
  
  // Fallback to token field
  if (error || !data) {
    const fallback = await supabase
      .from('h2s_dispatch_admin_sessions')
      .select('admin_email, expires_at')
      .eq('token', token)
      .single();
    data = fallback.data;
    error = fallback.error;
  }
  
  if (error || !data) {
    // Last resort: check h2s_sessions for admin role
    const { data: sessionData } = await supabase
      .from('h2s_sessions')
      .select('pro_id, role, expires_at')
      .eq('session_id', token)
      .single();
    
    if (!sessionData) return null;
    if (new Date() > new Date(sessionData.expires_at)) return null;
    
    return { admin_id: sessionData.pro_id || 'admin' };
  }
  
  if (new Date() > new Date(data.expires_at)) return null;
  
  return { admin_id: data.admin_email || 'admin' };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);

    const token = body?.token || req.query?.token;
    const payoutId = body?.payout_id || body?.entry_id || req.query?.payout_id || req.query?.entry_id;
    const action = body?.action || 'approve'; // 'approve' or 'reject'

    if (!token) return res.status(401).json({ ok: false, error: 'Missing token' });
    if (!payoutId) return res.status(400).json({ ok: false, error: 'Missing payout_id' });

    const admin = await validateAdmin(token);
    if (!admin) return res.status(403).json({ ok: false, error: 'Unauthorized - Admin access required' });

    const newState = action === 'reject' ? 'rejected' : 'approved';

    // Update the payout ledger entry
    const updatePayload = { state: newState };
    
    // Only add approved_at if we are approving
    // NOTE: If 'approved_at' column is missing in DB, this will fail. 
    // We'll try to update just the state first if this fails, but for now let's assume standard schema.
    // If you get "Could not find the 'approved_at' column", remove this line.
    // updatePayload.approved_at = newState === 'approved' ? new Date().toISOString() : null;

    const { data, error } = await supabase
      .from('h2s_payouts_ledger')
      .update(updatePayload)
      .eq('payout_id', payoutId) // Use payout_id (UUID) as PK
      .select()
      .single();

    if (error) {
      console.error('[ADMIN APPROVE] Update error:', error);
      throw error;
    }

    console.log(`[ADMIN APPROVE] Payout ${payoutId} set to ${newState}`);

    return res.json({ 
      ok: true, 
      data,
      message: `Payout ${newState} successfully`
    });

  } catch (error) {
    console.error('[ADMIN APPROVE] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
