import { createClient } from '@supabase/supabase-js';
import { calculatePayout } from './utils/payout_calculator.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: { bodyParser: true },
};

// Helper to run backfill logic internally
async function runInternalBackfill(proId) {
  console.log(`[INTERNAL BACKFILL] Starting for pro: ${proId}`);
  try {
    const { data: assignments } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('assign_id, job_id, pro_id, completed_at, state')
      .eq('pro_id', proId)
      .eq('state', 'completed');

    if (!assignments || assignments.length === 0) return 0;

    let createdCount = 0;
    for (const assign of assignments) {
      // Check existence
      const { data: existing } = await supabase
        .from('h2s_payouts_ledger')
        .select('entry_id')
        .eq('job_id', assign.job_id)
        .eq('pro_id', proId)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Fetch details
      const { data: job } = await supabase.from('h2s_dispatch_jobs').select('*').eq('job_id', assign.job_id).single();
      if (!job) continue;
      
      const { data: lines } = await supabase.from('h2s_dispatch_job_lines').select('*').eq('job_id', assign.job_id);
      const { data: teammates } = await supabase.from('h2s_dispatch_job_teammates').select('*').eq('job_id', assign.job_id).maybeSingle();

      // Calculate
      const calc = calculatePayout(job, lines || [], teammates);
      
      let amount = 0;
      let note = 'Auto-Backfilled';
      
      if (calc.split_details) {
        if (String(proId) === String(teammates?.primary_pro_id)) { amount = calc.primary_amount; note += ' (Primary)'; }
        else if (String(proId) === String(teammates?.secondary_pro_id)) { amount = calc.secondary_amount; note += ' (Secondary)'; }
      } else {
        amount = calc.total;
        note += ' (Solo)';
      }

      if (amount > 0) {
        await supabase.from('h2s_payouts_ledger').insert({
          pro_id: proId,
          job_id: assign.job_id,
          total_amount: amount,
          amount: amount,
          base_amount: amount,
          service_name: job.resources_needed || 'Service',
          variant_code: job.variant_code || 'STANDARD',
          state: 'approved',
          earned_at: assign.completed_at || job.completed_at || new Date().toISOString(),
          customer_total: job.metadata?.items_json ? job.metadata.items_json.reduce((s, i) => s + (i.line_total||0), 0) : 0,
          note: note
        });
        createdCount++;
      }
    }
    console.log(`[INTERNAL BACKFILL] Created ${createdCount} missing entries.`);
    return createdCount;
  } catch (err) {
    console.error('[INTERNAL BACKFILL] Error:', err);
    return 0;
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
    if ((!payouts || payouts.length === 0) && !payoutError) {
      console.log('[PORTAL_PAYOUTS] No payouts found. Triggering internal backfill...');
      const fixedCount = await runInternalBackfill(proId);
      
      if (fixedCount > 0) {
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
      rows: payouts || []
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
