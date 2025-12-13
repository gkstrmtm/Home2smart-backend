/**
 * BACKFILL PAYOUTS - Vercel Endpoint
 * 
 * POST /api/backfill_payouts
 * 
 * Finds all completed jobs without payout entries and creates them.
 * Returns detailed logs of what was created/skipped/failed.
 */

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // TEMPORARY: Skip auth for testing - REMOVE IN PRODUCTION
  // const authHeader = req.headers.authorization;
  // if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
  //   return res.status(401).json({ 
  //     ok: false, 
  //     error: 'Unauthorized - Missing or invalid admin secret' 
  //   });
  // }

  const logs = [];
  const log = (msg) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    log('========================================');
    log('💰 BACKFILL MISSING PAYOUTS - STARTED');
    log('========================================');

    // Initialize Supabase with error handling
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing Supabase credentials in environment variables');
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Get all completed assignments
    const { data: assignments, error: assignError } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('*')
      .eq('state', 'completed');

    if (assignError) throw assignError;
    
    log(`Found ${assignments.length} completed assignments`);

    // 2. Get existing payouts to avoid duplicates
    const { data: existingPayouts, error: payoutError } = await supabase
      .from('h2s_payouts_ledger')
      .select('job_id, pro_id');

    if (payoutError) throw payoutError;

    const payoutKeys = new Set(
      existingPayouts.map(p => `${p.job_id}|${p.pro_id}`)
    );
    
    log(`Found ${existingPayouts.length} existing payout entries`);

    // 3. Get all jobs, job lines, and team splits
    const { data: jobs, error: jobsError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*');
    
    if (jobsError) throw jobsError;

    const { data: jobLines, error: linesError} = await supabase
      .from('h2s_dispatch_job_lines')
      .select('*');
    
    if (linesError) throw linesError;

    const { data: teamSplits, error: splitsError } = await supabase
      .from('h2s_dispatch_job_teammates')
      .select('*');
    
    if (splitsError) throw splitsError;

    // Index for quick lookup
    const jobsById = {};
    jobs.forEach(j => { jobsById[j.job_id] = j; });

    const linesByJob = {};
    jobLines.forEach(l => {
      if (!linesByJob[l.job_id]) linesByJob[l.job_id] = [];
      linesByJob[l.job_id].push(l);
    });

    const splitsByJob = {};
    teamSplits.forEach(t => { splitsByJob[t.job_id] = t; });

    let created = 0;
    let skipped = 0;
    let errors = 0;

    // 4. Process each completed assignment
    for (const assignment of assignments) {
      const jobId = assignment.job_id;
      const proId = assignment.pro_id;
      const key = `${jobId}|${proId}`;

      // Skip if payout already exists
      if (payoutKeys.has(key)) {
        skipped++;
        continue;
      }

      const job = jobsById[jobId];
      if (!job) {
        log(`⚠️ Job not found: ${jobId}`);
        errors++;
        continue;
      }

      const lines = linesByJob[jobId] || [];
      if (lines.length === 0) {
        log(`⚠️ No line items for job ${jobId.substring(0, 8)} - skipping`);
        errors++;
        continue;
      }

      // Calculate total payout from line items
      let totalJobPayout = 0;
      lines.forEach(line => {
        const linePayout = parseFloat(line.calc_pro_payout_total || 0);
        totalJobPayout += linePayout;
      });

      if (totalJobPayout === 0) {
        log(`⚠️ Zero payout for job ${jobId.substring(0, 8)} - skipping`);
        errors++;
        continue;
      }

      log(`Job ${jobId.substring(0, 8)}: $${totalJobPayout.toFixed(2)}`);

      // Check for team split
      const teamSplit = splitsByJob[jobId];
      const completedAt = assignment.completed_at || new Date().toISOString();

      if (teamSplit && teamSplit.secondary_pro_id) {
        // TEAM JOB
        const primaryProId = teamSplit.primary_pro_id;
        const secondaryProId = teamSplit.secondary_pro_id;
        const splitMode = teamSplit.split_mode || 'percent';

        let primaryAmount = 0;
        let secondaryAmount = 0;

        if (splitMode === 'percent') {
          const primaryPercent = parseFloat(teamSplit.primary_percent || 50);
          const secondaryPercent = 100 - primaryPercent;
          primaryAmount = Math.round(totalJobPayout * primaryPercent) / 100;
          secondaryAmount = Math.round(totalJobPayout * secondaryPercent) / 100;
        } else {
          primaryAmount = parseFloat(teamSplit.primary_flat || 0);
          secondaryAmount = parseFloat(teamSplit.secondary_flat || 0);
        }

        // Create payout for the pro who completed (either primary or secondary)
        if (proId === primaryProId && primaryAmount > 0) {
          const { error } = await supabase.from('h2s_payouts_ledger').insert({
            pro_id: primaryProId,
            job_id: jobId,
            service_id: job.service_id || '',
            service_name: job.service_name || 'Job Payout',
            amount: primaryAmount,
            note: 'Team job - Primary tech (backfilled)',
            created_at: completedAt,
            paid_at: null
          });

          if (error) {
            log(`  ❌ Error creating primary payout: ${error.message}`);
            errors++;
          } else {
            log(`  ✅ Created primary: $${primaryAmount.toFixed(2)} → ${primaryProId.substring(0, 8)}`);
            created++;
          }
        } else if (proId === secondaryProId && secondaryAmount > 0) {
          const { error } = await supabase.from('h2s_payouts_ledger').insert({
            pro_id: secondaryProId,
            job_id: jobId,
            service_id: job.service_id || '',
            service_name: job.service_name || 'Job Payout',
            amount: secondaryAmount,
            note: 'Team job - Secondary tech (backfilled)',
            created_at: completedAt,
            paid_at: null
          });

          if (error) {
            log(`  ❌ Error creating secondary payout: ${error.message}`);
            errors++;
          } else {
            log(`  ✅ Created secondary: $${secondaryAmount.toFixed(2)} → ${secondaryProId.substring(0, 8)}`);
            created++;
          }
        }
      } else {
        // SOLO JOB
        const { error } = await supabase.from('h2s_payouts_ledger').insert({
          pro_id: proId,
          job_id: jobId,
          service_id: job.service_id || '',
          service_name: job.service_name || 'Job Payout',
          amount: totalJobPayout,
          note: 'Solo job completion (backfilled)',
          created_at: completedAt,
          paid_at: null
        });

        if (error) {
          log(`  ❌ Error creating solo payout: ${error.message}`);
          errors++;
        } else {
          log(`  ✅ Created solo: $${totalJobPayout.toFixed(2)} → ${proId.substring(0, 8)}`);
          created++;
        }
      }
    }

    log('========================================');
    log('BACKFILL SUMMARY:');
    log(`  ✅ Created: ${created} payouts`);
    log(`  ⏭️  Skipped: ${skipped} (already exist)`);
    log(`  ❌ Errors: ${errors}`);
    log('========================================');

    return res.status(200).json({
      ok: true,
      created,
      skipped,
      errors,
      logs
    });

  } catch (error) {
    log(`❌ FATAL ERROR: ${error.message}`);
    console.error('Backfill error:', error);
    
    return res.status(500).json({
      ok: false,
      error: error.message,
      logs
    });
  }
};
