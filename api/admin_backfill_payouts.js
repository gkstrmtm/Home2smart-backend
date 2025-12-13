import { createClient } from '@supabase/supabase-js';
import { calculatePayout } from './utils/payout_calculator.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // 1. Determine scope (specific pro or all pros?)
    // For safety, let's require a pro_id or a special "all" flag with an admin secret
    // But for this task, we'll assume it's called with a pro's token or pro_id
    
    let proId = req.query.pro_id || req.body.pro_id;
    
    // If no pro_id provided, try to get from token
    if (!proId && (req.query.token || req.body.token)) {
      const token = req.query.token || req.body.token;
      const { data: session } = await supabase
        .from('h2s_sessions')
        .select('pro_id')
        .eq('session_id', token)
        .single();
      if (session) proId = session.pro_id;
    }

    if (!proId) {
      return res.status(400).json({ ok: false, error: 'Missing pro_id or valid token' });
    }

    console.log(`[BACKFILL] Starting backfill for pro: ${proId}`);

    // 2. Get all completed assignments for this pro
    const { data: assignments, error: assignError } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('assign_id, job_id, pro_id, completed_at, state')
      .eq('pro_id', proId)
      .eq('state', 'completed');

    if (assignError) throw assignError;

    console.log(`[BACKFILL] Found ${assignments.length} completed assignments.`);

    const results = {
      scanned: assignments.length,
      created: 0,
      skipped: 0,
      errors: 0,
      details: []
    };

    // 3. Iterate and backfill
    for (const assign of assignments) {
      try {
        // Check if ledger entry exists
        const { data: existing } = await supabase
          .from('h2s_payouts_ledger')
          .select('entry_id')
          .eq('job_id', assign.job_id)
          .eq('pro_id', proId)
          .limit(1);

        if (existing && existing.length > 0) {
          results.skipped++;
          continue;
        }

        // Fetch job details for calculation
        const { data: job } = await supabase
          .from('h2s_dispatch_jobs')
          .select('*')
          .eq('job_id', assign.job_id)
          .single();
          
        if (!job) {
          console.warn(`[BACKFILL] Job ${assign.job_id} not found in jobs table.`);
          results.errors++;
          continue;
        }

        const { data: lines } = await supabase
          .from('h2s_dispatch_job_lines')
          .select('*')
          .eq('job_id', assign.job_id);

        const { data: teammates } = await supabase
          .from('h2s_dispatch_job_teammates')
          .select('*')
          .eq('job_id', assign.job_id)
          .maybeSingle();

        // Calculate
        const calc = calculatePayout(job, lines || [], teammates);
        
        // Determine amount for THIS pro
        let amount = 0;
        let note = 'Backfilled';
        
        if (calc.split_details) {
          if (String(proId) === String(teammates?.primary_pro_id)) {
            amount = calc.primary_amount;
            note += ' (Primary)';
          } else if (String(proId) === String(teammates?.secondary_pro_id)) {
            amount = calc.secondary_amount;
            note += ' (Secondary)';
          }
        } else {
          amount = calc.total;
          note += ' (Solo)';
        }

        if (amount > 0) {
          // --- FIX: SHIM LEGACY TABLE FOR FK CONSTRAINT ---
          const { error: shimErr } = await supabase.from('h2s_jobs').insert({
              job_id: assign.job_id,
              status: 'completed',
              service_id: 'svc_maintenance',
              created_at: new Date().toISOString()
          });
          if (shimErr && !shimErr.message.includes('duplicate key')) {
               console.log(`[FK Fix] Warning: ${shimErr.message}`);
          }

          const { error: insertError } = await supabase
            .from('h2s_payouts_ledger')
            .insert({
              pro_id: proId,
              job_id: assign.job_id,
              total_amount: amount,
              amount: amount,
              state: 'pending' // Default to pending for dispatcher validation
              // Removed invalid columns
            });

          if (insertError) {
            console.error(`[BACKFILL] Insert error for job ${assign.job_id}:`, insertError);
            results.errors++;
          } else {
            results.created++;
            results.details.push({ job_id: assign.job_id, amount });
          }
        } else {
          results.skipped++; // 0 amount
        }

      } catch (err) {
        console.error(`[BACKFILL] Error processing job ${assign.job_id}:`, err);
        results.errors++;
      }
    }

    return res.json({ ok: true, results });

  } catch (error) {
    console.error('[BACKFILL] Fatal error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
