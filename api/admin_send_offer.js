import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * Validate admin session
 */
async function validateAdminSession(token) {
  if (!token) return false;
  
  const { data, error } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('admin_email')
    .eq('session_id', token)
    .gte('expires_at', new Date().toISOString())
    .single();

  if (error || !data) return false;
  
  await supabase
    .from('h2s_dispatch_admin_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', token);
  
  return true;
}

/**
 * Send job offer to a tech
 * Creates an assignment record in h2s_dispatch_job_assignments
 */
export default async function handler(req, res) {
  // CORS
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
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    const { token, job_id, pro_id, distance_miles } = body;

    console.log('[admin_send_offer] Request:', { job_id, pro_id, distance_miles });

    // Validate admin session
    const isValid = await validateAdminSession(token);
    if (!isValid) {
      console.log('[admin_send_offer] Invalid or expired token');
      return res.status(401).json({
        ok: false,
        error: 'Not authorized',
        error_code: 'invalid_session'
      });
    }

    if (!job_id || !pro_id) {
      return res.status(400).json({
        ok: false,
        error: 'Missing job_id or pro_id',
        error_code: 'missing_parameters'
      });
    }

    console.log('[admin_send_offer] ✅ Admin session valid');

    // Check if offer already exists
    const { data: existing } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('assign_id, state')
      .eq('job_id', job_id)
      .eq('pro_id', pro_id)
      .single();

    if (existing) {
      console.log('[admin_send_offer] Offer already exists:', existing.state);
      return res.status(409).json({
        ok: false,
        error: `Offer already ${existing.state} for this tech`,
        error_code: 'duplicate_offer',
        existing_state: existing.state
      });
    }

    // Create offer
    const now = new Date().toISOString();
    const offerToken = crypto.randomUUID();

    const { data: newOffer, error: offerError } = await supabase
      .from('h2s_dispatch_job_assignments')
      .insert({
        job_id,
        pro_id,
        state: 'offered',
        offer_sent_at: now,
        offer_token: offerToken,
        distance_miles: distance_miles || null,
        picked_by_rule: 'manual_dispatch',
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (offerError) {
      console.error('[admin_send_offer] Offer creation failed:', offerError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create offer',
        error_code: 'insert_failed',
        details: offerError.message
      });
    }

    console.log('[admin_send_offer] ✅ Offer created:', newOffer.assign_id);

    // Update job status to 'offer_sent' if it's still 'pending'
    await supabase
      .from('h2s_dispatch_jobs')
      .update({ status: 'offer_sent', updated_at: now })
      .eq('job_id', job_id)
      .eq('status', 'pending');

    // Send notification to tech (SMS via notify-pro)
    try {
      const notifyEndpoint = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}/api/notify-pro`
        : 'https://h2s-backend.vercel.app/api/notify-pro';

      console.log('[admin_send_offer] Sending SMS notification to tech...');
      
      await fetch(notifyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id,
          pro_id,
          type: 'new_job_assignment'
        })
      });

      console.log('[admin_send_offer] ✅ Pro notified via SMS');
    } catch (notifyError) {
      console.warn('[admin_send_offer] SMS notification failed (non-critical):', notifyError.message);
    }

    // If auto-accepted, send pro_assigned email to customer
    if (newOffer.state === 'accepted') {
      try {
        const emailEndpoint = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}/api/send-pro-assigned-email`
          : 'https://h2s-backend.vercel.app/api/send-pro-assigned-email';

        console.log('[admin_send_offer] Sending pro_assigned email to customer...');
        
        await fetch(emailEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id,
            pro_id
          })
        });

        console.log('[admin_send_offer] ✅ Customer notified via email');
      } catch (emailError) {
        console.warn('[admin_send_offer] Email notification failed (non-critical):', emailError.message);
      }
    }

    return res.status(200).json({
      ok: true,
      offer: {
        assign_id: newOffer.assign_id,
        job_id,
        pro_id,
        state: 'offered',
        offer_sent_at: now
      }
    });

  } catch (error) {
    console.error('[admin_send_offer] Unexpected error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      error_code: 'internal_error',
      details: error.message
    });
  }
}
