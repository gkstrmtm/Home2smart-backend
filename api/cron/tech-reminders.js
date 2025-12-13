import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * CRON JOB: Send tech reminders for accepted jobs
 * Runs multiple times per day:
 * - 6 PM: Day-before reminders (for jobs tomorrow)
 * - 7 AM: Morning-of reminders (for jobs today)
 * - Every hour: 2-hour reminders (for jobs starting in 2h)
 */
export default async function handler(req, res) {
  // Verify cron secret
  const authHeader = req.headers.authorization || '';
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[Cron/Tech Reminders] Unauthorized access attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { type } = req.query || {}; // 'day_before', 'morning_of', 'two_hour'

  if (!type || !['day_before', 'morning_of', 'two_hour'].includes(type)) {
    return res.status(400).json({ error: 'Missing or invalid type parameter' });
  }

  console.log(`[Cron/Tech Reminders] Starting ${type} reminder job...`);

  try {
    const now = new Date();
    let targetTime = null;
    let reminderType = '';

    // Calculate target time window based on reminder type
    if (type === 'day_before') {
      // Jobs starting tomorrow (between 00:00 and 23:59 tomorrow)
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const tomorrowEnd = new Date(tomorrow);
      tomorrowEnd.setHours(23, 59, 59, 999);
      targetTime = { start: tomorrow.toISOString(), end: tomorrowEnd.toISOString() };
      reminderType = 'day_before_reminder';
    } else if (type === 'morning_of') {
      // Jobs starting today (between now and end of today)
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      targetTime = { start: todayStart.toISOString(), end: todayEnd.toISOString() };
      reminderType = 'morning_of_reminder';
    } else if (type === 'two_hour') {
      // Jobs starting in approximately 2 hours (1.5h to 2.5h window)
      const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const windowStart = new Date(twoHoursFromNow.getTime() - 30 * 60 * 1000); // 1.5h
      const windowEnd = new Date(twoHoursFromNow.getTime() + 30 * 60 * 1000); // 2.5h
      targetTime = { start: windowStart.toISOString(), end: windowEnd.toISOString() };
      reminderType = 'two_hour_reminder';
    }

    // Find jobs with accepted assignments in the target time window
    const { data: jobs, error: jobsError } = await supabase
      .from('h2s_dispatch_jobs')
      .select(`
        job_id,
        customer_name,
        service_name,
        service_type,
        service_address,
        service_city,
        service_state,
        customer_phone,
        customer_email,
        notes_from_customer,
        resources_needed,
        resources_needed_override,
        start_iso,
        end_iso,
        h2s_dispatch_job_assignments!inner(
          assign_id,
          pro_id,
          state
        )
      `)
      .eq('status', 'accepted')
      .eq('h2s_dispatch_job_assignments.state', 'accepted')
      .gte('start_iso', targetTime.start)
      .lte('start_iso', targetTime.end);

    if (jobsError) {
      console.error('[Cron/Tech Reminders] Query failed:', jobsError);
      return res.status(500).json({ error: jobsError.message });
    }

    if (!jobs || jobs.length === 0) {
      console.log(`[Cron/Tech Reminders] No jobs found for ${type} reminders`);
      return res.json({ ok: true, sent: 0, message: 'No reminders to send' });
    }

    console.log(`[Cron/Tech Reminders] Found ${jobs.length} jobs for ${type} reminders`);

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    // Check for duplicate reminders (idempotency)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentReminders } = await supabase
      .from('h2s_sms_log')
      .select('job_id, template_name, phone')
      .gte('sent_at', twentyFourHoursAgo)
      .eq('template_name', reminderType);

    const reminderMap = new Map();
    (recentReminders || []).forEach(r => {
      const key = `${r.job_id}_${r.phone}`;
      reminderMap.set(key, true);
    });

    // Send reminders for each job
    for (const job of jobs) {
      const assignments = job.h2s_dispatch_job_assignments || [];
      
      for (const assignment of assignments) {
        if (assignment.state !== 'accepted') continue;

        // Get pro details
        const { data: pro } = await supabase
          .from('h2s_pros')
          .select('pro_id, name, phone, email')
          .eq('pro_id', assignment.pro_id)
          .single();

        if (!pro || !pro.phone) {
          console.warn(`[Cron/Tech Reminders] Pro ${assignment.pro_id} not found or no phone`);
          continue;
        }

        // Check idempotency
        const reminderKey = `${job.job_id}_${pro.phone}`;
        if (reminderMap.has(reminderKey)) {
          console.log(`[Cron/Tech Reminders] Skipping duplicate reminder for job ${job.job_id}, pro ${pro.phone}`);
          skipped++;
          continue;
        }

        // Send reminder via notify-pro
        try {
          const notifyEndpoint = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}/api/notify-pro`
            : 'https://h2s-backend.vercel.app/api/notify-pro';

          const notifyResponse = await fetch(notifyEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              job_id: job.job_id,
              pro_id: pro.pro_id,
              type: reminderType
            })
          });

          if (notifyResponse.ok) {
            sent++;
            console.log(`[Cron/Tech Reminders] ✅ Reminder sent to ${pro.name} (${pro.phone}) for job ${job.job_id}`);
            // Mark as sent in our map to prevent duplicates in same run
            reminderMap.set(reminderKey, true);
          } else {
            const errorText = await notifyResponse.text();
            console.error(`[Cron/Tech Reminders] Failed for ${pro.phone}:`, errorText);
            failed++;
          }
        } catch (err) {
          console.error(`[Cron/Tech Reminders] Error for ${pro.phone}:`, err);
          failed++;
        }
      }
    }

    console.log(`[Cron/Tech Reminders] ✅ Complete: ${sent} sent, ${skipped} skipped, ${failed} failed`);

    return res.json({
      ok: true,
      type,
      sent,
      skipped,
      failed,
      total_jobs: jobs.length
    });

  } catch (error) {
    console.error('[Cron/Tech Reminders] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

