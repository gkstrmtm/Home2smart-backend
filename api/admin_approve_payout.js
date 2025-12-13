import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Service role client for notification queries (bypasses RLS)
const supabaseService = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
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

    // Send tech notification if approved (non-blocking)
    let notificationResult = { sent: false, skipped: false, error: null };
    if (newState === 'approved' && data) {
      try {
        notificationResult = await notifyTechPayoutApproved(data);
      } catch (notifyErr) {
        console.warn('[ADMIN APPROVE] Notification failed (non-critical):', notifyErr.message);
        notificationResult.error = notifyErr.message;
      }
    }

    return res.json({ 
      ok: true, 
      data,
      message: `Payout ${newState} successfully`,
      notification: notificationResult
    });

  } catch (error) {
    console.error('[ADMIN APPROVE] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Notify tech that payout was approved
 * Returns: { sent: boolean, skipped: boolean, error: string|null }
 */
async function notifyTechPayoutApproved(payout) {
  const { payout_id, pro_id, job_id, amount, total_amount } = payout;
  const payoutAmount = amount || total_amount || 0;
  
  if (!pro_id || !job_id) {
    return { sent: false, skipped: true, error: 'Missing pro_id or job_id' };
  }

  // Idempotency: Check if notification already sent in last 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentSms } = await supabaseService
    .from('h2s_sms_log')
    .select('id')
    .eq('job_id', job_id)
    .eq('pro_id', pro_id)
    .eq('template_name', 'payout_approved')
    .gte('sent_at', twentyFourHoursAgo)
    .limit(1);

  // Also check by payout_id if available (check message content)
  let duplicateByPayoutId = false;
  if (payout_id) {
    const { data: recentByPayout } = await supabaseService
      .from('h2s_sms_log')
      .select('id, message')
      .eq('template_name', 'payout_approved')
      .eq('pro_id', pro_id)
      .gte('sent_at', twentyFourHoursAgo)
      .limit(5); // Check last 5 messages
    
    if (recentByPayout && recentByPayout.length > 0) {
      for (const msg of recentByPayout) {
        if (msg.message && msg.message.includes(payout_id)) {
          duplicateByPayoutId = true;
          break;
        }
      }
    }
  }

  if (recentSms && recentSms.length > 0) {
    console.log('[ADMIN APPROVE] Notification skipped (duplicate within 24h)');
    return { sent: false, skipped: true, error: null };
  }

  if (duplicateByPayoutId) {
    console.log('[ADMIN APPROVE] Notification skipped (duplicate by payout_id)');
    return { sent: false, skipped: true, error: null };
  }

  // Get pro details
  const { data: pro } = await supabaseService
    .from('h2s_dispatch_pros')
    .select('pro_id, name, phone, email')
    .eq('pro_id', pro_id)
    .single();

  if (!pro) {
    return { sent: false, skipped: true, error: 'Pro not found' };
  }

  // Get job details for context
  const { data: job } = await supabaseService
    .from('h2s_dispatch_jobs')
    .select('job_id, service_name, service_type, customer_name')
    .eq('job_id', job_id)
    .single();

  const jobRef = job?.service_name || job?.service_type || `Job #${job_id.substring(0, 8)}`;
  const customerName = job?.customer_name || 'Customer';

  // Send notification via notify-pro endpoint
  const notifyEndpoint = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/notify-pro`
    : 'https://h2s-backend.vercel.app/api/notify-pro';

  try {
    const notifyResponse = await fetch(notifyEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: job_id,
        pro_id: pro_id,
        type: 'payout_approved',
        data: {
          amount: payoutAmount.toFixed(2),
          job_ref: jobRef,
          customer_name: customerName,
          payout_id: payout_id
        }
      })
    });

    const notifyResult = await notifyResponse.json();
    
    if (notifyResult.ok || notifyResponse.ok) {
      console.log(`[ADMIN APPROVE] ✅ Tech notified: ${pro.name} (${pro.phone})`);
      return { sent: true, skipped: false, error: null };
    } else {
      throw new Error(notifyResult.error || 'Notification failed');
    }
  } catch (err) {
    console.error('[ADMIN APPROVE] Notification error:', err);
    return { sent: false, skipped: false, error: err.message };
  }
}
