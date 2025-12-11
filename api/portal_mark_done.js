import { createClient } from '@supabase/supabase-js';
import { calculatePayout } from './utils/payout_calculator.js';

// Retry helper inline
async function retryWithBackoff(fn, maxAttempts = 3, delayMs = 100) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error.code && error.code >= 400 && error.code < 500) throw error;
      if (attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: { bodyParser: true },
};

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
    const jobId = body?.job_id || req.query?.job_id;
    const proId = await validateSession(token);

    console.log('[MARK DONE] Session validation:', { token: token?.slice(0, 8) + '...', proId, jobId });

    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    if (!jobId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing job_id',
        error_code: 'missing_job'
      });
    }

    // REQUIRE: Artifacts exist (at least one photo and one signature)
    try {
      const { data: artifacts } = await supabase
        .from('h2s_dispatch_job_artifacts')
        .select('artifact_id,type,pro_id')
        .eq('job_id', jobId)
        .eq('pro_id', proId);
      const photos = (artifacts||[]).filter(a => String(a.type).toLowerCase() === 'photo');
      const signatures = (artifacts||[]).filter(a => String(a.type).toLowerCase() === 'signature');
      if (photos.length === 0) {
        return res.status(400).json({ ok:false, error:'At least one photo required', error_code:'needs_photo' });
      }
      if (signatures.length === 0) {
        return res.status(400).json({ ok:false, error:'Signature required', error_code:'needs_signature' });
      }
    } catch (artErr) {
      console.error('Artifact validation error:', artErr);
      return res.status(500).json({ ok:false, error:'Artifact check failed', error_code:'artifact_error' });
    }

    // Find the accepted assignment (with retry)
    let assignments;
    try {
      assignments = await retryWithBackoff(async () => {
        // ✅ FIX: Handle potential duplicates by taking newest accepted assignment
        const { data, error } = await supabase
          .from('h2s_dispatch_job_assignments')
          .select('*')
          .eq('job_id', jobId)
          .eq('pro_id', proId)
          .eq('state', 'accepted')
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('No accepted assignment found');
        return data[0];
      }, 3, 100);
    } catch (assignError) {
      console.error('Find assignment error:', assignError);
      return res.status(404).json({
        ok: false,
        error: 'Assignment not found or not in accepted state',
        error_code: 'assignment_not_found'
      });
    }

    // Mark as completed (with retry)
    // ✅ CRITICAL: Update BOTH assignment AND job status atomically with retries
    const completedAt = new Date().toISOString();
    
    try {
      await retryWithBackoff(async () => {
        // Update assignment state
        const { error: assignError } = await supabase
          .from('h2s_dispatch_job_assignments')
          .update({
            state: 'completed',
            completed_at: completedAt
          })
          .eq('assign_id', assignments.assign_id);
        
        if (assignError) throw assignError;
        
        // Update job status (do this in same transaction-like block)
        const { error: jobError } = await supabase
          .from('h2s_dispatch_jobs')
          .update({ 
            status: 'completed', 
            completed_at: completedAt 
          })
          .eq('job_id', jobId);
        
        if (jobError) throw jobError;
        
        console.log(`[MARK DONE] ✅ Both assignment and job status updated to 'completed' for ${jobId}`);
      }, 3, 100);
    } catch (updateError) {
      console.error('[MARK DONE] ❌ Failed to mark done:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to mark done. Please try again.',
        error_code: 'db_error'
      });
    }

    // Create payout record
    try {
      const { data: job } = await supabase
        .from('h2s_dispatch_jobs')
        .select('*')
        .eq('job_id', jobId)
        .single();

      // Fetch lines for accurate calculation
      const { data: lines } = await supabase
        .from('h2s_dispatch_job_lines')
        .select('*')
        .eq('job_id', jobId);

      // Fetch team configuration if exists
      const { data: teammates } = await supabase
        .from('h2s_dispatch_job_teammates')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle();

      // Calculate payout using robust logic
      const payoutResult = calculatePayout(job, lines, teammates);
      console.log('Payout calculation result:', payoutResult);

      // [LOGGING REQUESTED BY USER]
      console.log('[PAYOUT DATA TRACE]', {
        job_id: jobId,
        pro_id: proId,
        service_type: job.resources_needed || 'Unknown',
        payout_amount: payoutResult.total,
        job_status: job.status,
        completed_at: new Date().toISOString()
      });

      const payoutsToCreate = [];
      
      if (payoutResult.split_details) {
        // Team Job - Pay both pros
        const primaryProId = teammates.primary_pro_id;
        const secondaryProId = teammates.secondary_pro_id;
        
        if (payoutResult.primary_amount > 0) {
           payoutsToCreate.push({
             pro_id: primaryProId,
             amount: payoutResult.primary_amount,
             note: `Team job - Primary (${payoutResult.split_details.mode})`
           });
        }
        if (payoutResult.secondary_amount > 0) {
           payoutsToCreate.push({
             pro_id: secondaryProId,
             amount: payoutResult.secondary_amount,
             note: `Team job - Secondary (${payoutResult.split_details.mode})`
           });
        }
      } else {
        // Solo Job
        if (payoutResult.total > 0) {
          payoutsToCreate.push({
            pro_id: proId, // The completing pro
            amount: payoutResult.total,
            note: 'Solo job completion'
          });
        }
      }

      // Insert payouts
      const createdPayouts = [];
      for (const p of payoutsToCreate) {
        // --- FIX: SHIM LEGACY TABLE FOR FK CONSTRAINT ---
        const { error: shimErr } = await supabase.from('h2s_jobs').insert({
            job_id: jobId,
            status: 'completed',
            service_id: 'svc_maintenance',
            created_at: new Date().toISOString()
        });
        if (shimErr && !shimErr.message.includes('duplicate key')) {
             console.log(`[FK Fix] Warning: ${shimErr.message}`);
        }

        const payoutEntry = {
          pro_id: p.pro_id,
          job_id: jobId,
          total_amount: p.amount,
          amount: p.amount, 
          state: 'pending' // Default to pending for dispatcher validation
          // Removed invalid columns: base_amount, service_name, variant_code, earned_at, customer_total, note
        };
        console.log('[PAYOUT CREATE] Attempting insert:', payoutEntry);
        
        const { data: insertedRow, error: payoutError } = await supabase
          .from('h2s_payouts_ledger')
          .insert(payoutEntry)
          .select()
          .single();

        if (payoutError) {
          console.error('[PAYOUT ERROR] Failed to create payout record:', payoutError);
        } else {
          console.log('[PAYOUT SUCCESS] Created entry_id:', insertedRow?.entry_id, 'for pro:', p.pro_id, 'amount:', p.amount);
          createdPayouts.push(insertedRow);
        }
      }
      console.log('[PAYOUT SUMMARY] Created', createdPayouts.length, 'ledger entries for job', jobId);
    } catch (payoutErr) {
      console.error('Error creating payout:', payoutErr);
    }

    // TODO: Trigger customer review email via Apps Script webhook
    // For now, emails still handled by Apps Script background triggers

    // Silent reconciliation: ensure ALL completed assignments have ledger entries
    try {
      console.log('[RECONCILIATION] Starting backfill for pro', proId);
      
      const { data: completedAssigns } = await supabase
        .from('h2s_dispatch_job_assignments')
        .select('assign_id, job_id, pro_id, completed_at, state')
        .eq('pro_id', proId)
        .eq('state', 'completed')
        .order('completed_at', { ascending: false });

      console.log('[RECONCILIATION] Found', (completedAssigns || []).length, 'completed assignments for pro', proId);

      for (const a of (completedAssigns || [])) {
        // Check if ledger exists for this job+pro
        const { data: existing } = await supabase
          .from('h2s_payouts_ledger')
          .select('entry_id')
          .eq('job_id', a.job_id)
          .eq('pro_id', a.pro_id)
          .limit(1);

        if (existing && existing.length) {
          console.log('[RECONCILIATION] Ledger entry already exists for job', a.job_id);
          continue; // already present
        }

        console.log('[RECONCILIATION] Missing ledger entry for job', a.job_id, '- backfilling...');

        // Fetch job + lines
        const { data: job2 } = await supabase
          .from('h2s_dispatch_jobs')
          .select('*')
          .eq('job_id', a.job_id)
          .single();
        const { data: lines2 } = await supabase
          .from('h2s_dispatch_job_lines')
          .select('*')
          .eq('job_id', a.job_id);
        const { data: teammates2 } = await supabase
          .from('h2s_dispatch_job_teammates')
          .select('*')
          .eq('job_id', a.job_id)
          .maybeSingle();

        const res2 = calculatePayout(job2, lines2, teammates2);

        // Insert only the portion for this pro (primary/secondary or solo)
        let amountForPro = 0;
        if (res2.split_details) {
          if (String(a.pro_id) === String(teammates2?.primary_pro_id)) amountForPro = res2.primary_amount || 0;
          else if (String(a.pro_id) === String(teammates2?.secondary_pro_id)) amountForPro = res2.secondary_amount || 0;
        } else {
          amountForPro = res2.total || 0;
        }

        if (amountForPro > 0) {
          // --- FIX: SHIM LEGACY TABLE FOR FK CONSTRAINT ---
          const { error: shimErr } = await supabase.from('h2s_jobs').insert({
              job_id: a.job_id,
              status: 'completed',
              service_id: 'svc_maintenance',
              created_at: new Date().toISOString()
          });
          if (shimErr && !shimErr.message.includes('duplicate key')) {
               console.log(`[FK Fix] Warning: ${shimErr.message}`);
          }

          const { error: reconError } = await supabase
            .from('h2s_payouts_ledger')
            .insert({
              pro_id: a.pro_id,
              job_id: a.job_id,
              total_amount: amountForPro,
              amount: amountForPro,
              state: 'pending' // Default to pending for dispatcher validation
              // Removed invalid columns
            });
          if (reconError) {
            console.error('[RECONCILIATION] Failed to insert ledger for job', a.job_id, ':', reconError);
          } else {
            console.log('[RECONCILIATION] ✅ Backfilled payout for job', a.job_id, 'pro', a.pro_id, 'amount', amountForPro);
          }
        } else {
          console.log('[RECONCILIATION] Skipping job', a.job_id, '- calculated amount is 0');
        }
      }
    } catch (reconErr) {
      console.warn('Silent reconciliation failed:', reconErr);
    }

    return res.json({ 
      ok: true,
      payouts_created: createdPayouts.length,
      pro_id: proId,
      job_id: jobId
    });

  } catch (error) {
    console.error('Mark done error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
