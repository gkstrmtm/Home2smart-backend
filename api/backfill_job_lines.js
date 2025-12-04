/**
 * BACKFILL JOB LINES - Populate h2s_dispatch_job_lines from job metadata
 * 
 * POST /api/backfill_job_lines
 * 
 * Extracts estimated_payout from h2s_dispatch_jobs.metadata and creates
 * line items in h2s_dispatch_job_lines so payouts can be calculated.
 */

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const logs = [];
  const log = (msg) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    log('========================================');
    log('📦 BACKFILL JOB LINES - STARTED');
    log('========================================');

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 1. Get all jobs
    const { data: jobs, error: jobsError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*');

    if (jobsError) throw jobsError;
    log(`Found ${jobs.length} total jobs`);

    // 2. Get existing line items to avoid duplicates
    const { data: existingLines, error: linesError } = await supabase
      .from('h2s_dispatch_job_lines')
      .select('job_id');

    if (linesError) throw linesError;

    const jobsWithLines = new Set(existingLines.map(l => l.job_id));
    log(`Found ${existingLines.length} existing line items`);

    let created = 0;
    let skipped = 0;
    let errors = 0;

    // 3. Process each job
    for (const job of jobs) {
      // Skip if already has line item
      if (jobsWithLines.has(job.job_id)) {
        skipped++;
        continue;
      }

      // Extract payout from metadata
      const metadata = job.metadata || {};
      const estimatedPayout = parseFloat(metadata.estimated_payout || 0);

      if (estimatedPayout === 0) {
        log(`⚠️ Job ${job.job_id.substring(0, 8)}: No payout in metadata`);
        errors++;
        continue;
      }

      // Calculate customer price from metadata if available
      let customerTotal = 0;
      const itemsJson = metadata.items_json || [];
      if (Array.isArray(itemsJson)) {
        itemsJson.forEach(item => {
          customerTotal += parseFloat(item.price || 0) * parseInt(item.quantity || 1);
        });
      }

      // Determine quantity
      let qty = 1;
      if (Array.isArray(itemsJson) && itemsJson.length > 0) {
        qty = itemsJson.reduce((sum, item) => sum + parseInt(item.quantity || 1), 0);
      }

      // Create line item
      const lineData = {
        job_id: job.job_id,
        service_id: null, // Allow NULL instead of forcing UUID format
        variant_code: job.variant_code || 'STANDARD',
        qty: qty,
        unit_customer_price: customerTotal > 0 ? Math.round((customerTotal / qty) * 100) / 100 : 0,
        line_customer_total: customerTotal,
        calc_pro_payout_total: estimatedPayout,
        note: 'Backfilled from job metadata',
        order_id: metadata.order_id || null,
        created_at: job.created_at
      };

      const { error: insertError } = await supabase
        .from('h2s_dispatch_job_lines')
        .insert(lineData);

      if (insertError) {
        log(`  ❌ Job ${job.job_id.substring(0, 8)}: ${insertError.message}`);
        errors++;
      } else {
        log(`  ✅ Job ${job.job_id.substring(0, 8)}: Created line with $${estimatedPayout} payout`);
        created++;
      }
    }

    log('========================================');
    log('BACKFILL SUMMARY:');
    log(`  ✅ Created: ${created} line items`);
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
