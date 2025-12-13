import { createClient } from '@supabase/supabase-js';
import { calculatePayout } from './utils/payout_calculator.js';

// Use Service Role if available to bypass RLS, otherwise Anon
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: { bodyParser: true },
};

// Helper to run backfill logic internally
async function runInternalBackfill(proId) {
  console.log(`[INTERNAL BACKFILL] Starting for pro: ${proId}`);
  const debugLog = [];
  try {
    const { data: assignments } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('assign_id, job_id, pro_id, completed_at, state')
      .eq('pro_id', proId)
      .in('state', ['completed', 'Completed']); // Handle case sensitivity

    if (!assignments || assignments.length === 0) {
      debugLog.push('No completed assignments found');
      return { count: 0, log: debugLog };
    }

    let createdCount = 0;
    for (const assign of assignments) {
      // Check existence
      const { data: existing } = await supabase
        .from('h2s_payouts_ledger')
        .select('entry_id')
        .eq('job_id', assign.job_id)
        .eq('pro_id', proId)
        .limit(1);

      if (existing && existing.length > 0) {
        debugLog.push(`Job ${assign.job_id}: Skipped (Ledger exists: ${existing[0].entry_id})`);
        continue;
      }

      // Fetch details
      const { data: job } = await supabase.from('h2s_dispatch_jobs').select('*').eq('job_id', assign.job_id).single();
      if (!job) {
        debugLog.push(`Job ${assign.job_id}: Skipped (Job not found in jobs table)`);
        continue;
      }
      
      const { data: lines } = await supabase.from('h2s_dispatch_job_lines').select('*').eq('job_id', assign.job_id);
      const { data: teammates } = await supabase.from('h2s_dispatch_job_teammates').select('*').eq('job_id', assign.job_id).maybeSingle();

      // Calculate
      const calc = calculatePayout(job, lines || [], teammates);
      
      let amount = 0;
      let note = 'Auto-Backfilled';
      
      if (calc.split_details) {
        if (String(proId) === String(teammates?.primary_pro_id)) { amount = calc.primary_amount; note += ' (Primary)'; }
        else if (String(proId) === String(teammates?.secondary_pro_id)) { amount = calc.secondary_amount; note += ' (Secondary)'; }
        else { debugLog.push(`Job ${assign.job_id}: Skipped (Pro ID ${proId} not in team split)`); }
      } else {
        amount = calc.total;
        note += ' (Solo)';
      }

      if (amount > 0) {
        // --- FIX: SHIM LEGACY TABLE FOR FK CONSTRAINT ---
        // The ledger table has a foreign key to 'h2s_jobs' (legacy), not 'h2s_dispatch_jobs'.
        // We must ensure a record exists there first.
        const { error: shimErr } = await supabase.from('h2s_jobs').insert({
            job_id: assign.job_id,
            status: 'completed',
            service_id: 'svc_maintenance', // Required non-null column
            created_at: new Date().toISOString()
        });
        
        if (shimErr && !shimErr.message.includes('duplicate key')) {
             debugLog.push(`Job ${assign.job_id}: Shim Warning (${shimErr.message})`);
        }

        // --- FIX: MINIMAL SCHEMA INSERT ---
        // Only insert columns that actually exist in the production database
        const { error: insertErr } = await supabase.from('h2s_payouts_ledger').insert({
          pro_id: proId,
          job_id: assign.job_id,
          total_amount: amount,
          amount: amount,
          state: 'pending' // Default to pending for dispatcher validation
          // Removed: base_amount, service_name, variant_code, earned_at, customer_total, note (Columns do not exist)
        });
        
        if (insertErr) {
           debugLog.push(`Job ${assign.job_id}: Insert Error (${insertErr.message})`);
        } else {
           createdCount++;
           debugLog.push(`Job ${assign.job_id}: Created payout $${amount}`);
        }
      } else {
        debugLog.push(`Job ${assign.job_id}: Skipped (Calculated amount is 0)`);
      }
    }
    console.log(`[INTERNAL BACKFILL] Created ${createdCount} missing entries.`);
    return { count: createdCount, log: debugLog };
  } catch (err) {
    console.error('[INTERNAL BACKFILL] Error:', err);
    debugLog.push(`Fatal Error: ${err.message}`);
    return { count: 0, log: debugLog };
  }
}

async function validateSession(token) {
  const { data, error } = await supabase
    .from('h2s_sessions')
    .select('pro_id, expires_at')
    .eq('session_id', token)
    .single();

  if (error || !data) return null;
  if (new Date() > new Date(data.expires_at)) return null;

  supabase
    .from('h2s_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', token)
    .then(() => {});

  return data.pro_id;
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
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const proId = await validateSession(token);

    console.log('[PORTAL_PAYOUTS] Request:', { token: token?.slice(0, 8) + '...', proId });

    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    // Get payouts for this pro
    let { data: payouts, error: payoutError } = await supabase
      .from('h2s_payouts_ledger')
      .select('*')
      .eq('pro_id', proId)
      .order('created_at', { ascending: false });

    // [AUTO-FIX] If no payouts found, try to backfill immediately
    let debugReport = [];
    if ((!payouts || payouts.length === 0) && !payoutError) {
      console.log('[PORTAL_PAYOUTS] No payouts found. Triggering internal backfill...');
      const { count, log } = await runInternalBackfill(proId);
      debugReport = log;
      
      if (count > 0) {
        // Re-fetch if we fixed anything
        const { data: retryPayouts } = await supabase
          .from('h2s_payouts_ledger')
          .select('*')
          .eq('pro_id', proId)
          .order('created_at', { ascending: false });
        payouts = retryPayouts;
      }
    }

    if (payoutError) {
      console.error('[PORTAL_PAYOUTS] Query error:', payoutError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to load payouts',
        error_code: 'query_error'
      });
    }

    console.log('[PAYOUTS FETCH]', {
      pro_id: proId,
      count: (payouts || []).length,
      sample: payouts && payouts.length > 0 ? payouts[0] : 'None'
    });

    console.log('[PORTAL_PAYOUTS] Found', (payouts || []).length, 'ledger entries for pro', proId);
    if (payouts && payouts.length > 0) {
      console.log('[PORTAL_PAYOUTS] Sample entry:', payouts[0]);
    }

    return res.json({
      ok: true,
      rows: payouts || [],
      debug_report: debugReport
    });

  } catch (error) {
    console.error('Payouts error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
