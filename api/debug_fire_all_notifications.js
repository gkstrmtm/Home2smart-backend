import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * DEBUG ENDPOINT: Fire all notification types in sequence
 * Routes all messages to manager allowlists for testing
 * 
 * GET /api/debug_fire_all_notifications?key=...&mode=live|dryrun&job_id=...&limit=...
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { key, mode = 'dryrun', job_id, limit } = req.query;

    // Validate secret key
    const expectedKey = process.env.DEBUG_FIRE_KEY?.trim();
    const providedKey = key?.trim();
    
    if (!providedKey || providedKey !== expectedKey) {
      console.log('[DEBUG FIRE] Key validation failed:', {
        provided: providedKey ? '***' : 'missing',
        expected: expectedKey ? '***' : 'missing',
        hasEnvVar: !!process.env.DEBUG_FIRE_KEY
      });
      return res.status(401).json({ 
        error: 'Unauthorized',
        hint: 'Missing or invalid key parameter'
      });
    }

    // Spam prevention: Check 10-minute cooldown
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('h2s_sms_log')
      .select('id')
      .eq('template_name', 'debug_fire_all')
      .gte('sent_at', tenMinutesAgo)
      .limit(1);

    if (recent && recent.length > 0) {
      return res.status(429).json({
        error: 'Cooldown active',
        message: 'This endpoint can only be called once every 10 minutes',
        retry_after: '10 minutes'
      });
    }

    // Get manager allowlists (fallback to MANAGEMENT_CONTACTS if env vars not set)
    let managerSmsList = (process.env.MANAGER_SMS_LIST || '').split(',').map(p => p.trim()).filter(Boolean);
    let managerEmailList = (process.env.MANAGER_EMAIL_LIST || '').split(',').map(e => e.trim()).filter(Boolean);
    
    // Fallback to MANAGEMENT_CONTACTS from config if env vars not set
    if (managerSmsList.length === 0) {
      const { MANAGEMENT_CONTACTS } = await import('./config/notifications.js');
      managerSmsList = MANAGEMENT_CONTACTS.phones || [];
    }
    if (managerEmailList.length === 0) {
      const { MANAGEMENT_CONTACTS } = await import('./config/notifications.js');
      managerEmailList = MANAGEMENT_CONTACTS.emails || ['h2sbackend@gmail.com'];
    }

    if (managerSmsList.length === 0 && managerEmailList.length === 0) {
      return res.status(400).json({
        error: 'Manager allowlists not configured',
        hint: 'Set MANAGER_SMS_LIST and/or MANAGER_EMAIL_LIST environment variables, or ensure MANAGEMENT_CONTACTS is configured'
      });
    }

    // Get base URL for internal API calls
    // Vercel provides VERCEL_URL in production, but we need to handle both cases
    let baseUrl = 'https://h2s-backend.vercel.app'; // Default production URL
    if (process.env.VERCEL_URL) {
      baseUrl = `https://${process.env.VERCEL_URL}`;
    } else if (req.headers.host) {
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      baseUrl = `${protocol}://${req.headers.host}`;
    }

    // Fetch job/order/pro data if job_id provided, otherwise use mock data
    let jobData = null;
    let proData = null;
    let orderData = null;

    if (job_id) {
      const { data: job } = await supabase
        .from('h2s_dispatch_jobs')
        .select('*')
        .eq('job_id', job_id)
        .single();
      jobData = job;

      if (job?.order_id) {
        const { data: order } = await supabase
          .from('h2s_orders')
          .select('*')
          .eq('id', job.order_id)
          .single();
        orderData = order;
      }

      // Get first assigned pro
      if (job) {
        const { data: assignment } = await supabase
          .from('h2s_dispatch_job_assignments')
          .select('pro_id')
          .eq('job_id', job_id)
          .limit(1)
          .single();
        
        if (assignment?.pro_id) {
          const { data: pro } = await supabase
            .from('h2s_dispatch_pros')
            .select('*')
            .eq('pro_id', assignment.pro_id)
            .single();
          proData = pro;
        }
      }
    } else {
      // Use mock data for testing
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const twoHoursLater = new Date(tomorrow);
      twoHoursLater.setHours(twoHoursLater.getHours() + 2);

      jobData = {
        job_id: 'debug_test_job_123',
        order_id: 'debug_test_order_123',
        service_name: 'Smart Thermostat Installation',
        service_type: 'Installation',
        customer_name: 'Test Customer',
        customer_phone: '+18641234567',
        customer_email: 'test@example.com',
        service_address: '123 Test Street',
        service_city: 'Greenville',
        service_state: 'SC',
        service_zip: '29601',
        notes_from_customer: 'Please call before arrival',
        start_iso: tomorrow.toISOString(),
        end_iso: twoHoursLater.toISOString(),
        status: 'accepted'
      };

      orderData = {
        id: 'debug_test_order_123',
        customer_name: 'Test Customer',
        service_name: 'Smart Thermostat Installation',
        delivery_date: tomorrow.toISOString().split('T')[0],
        delivery_time: '10:00 AM'
      };

      proData = {
        pro_id: 'debug_test_pro_123',
        name: 'Test Technician',
        phone: managerSmsList[0] || '+18641234567',
        email: managerEmailList[0] || 'h2sbackend@gmail.com'
      };
    }

    // Define notification sequence
    const notificationSequence = [
      { type: 'new_job_assignment', handler: 'notify-pro', needsJob: true, needsPro: true },
      { type: 'job_accepted_confirmation', handler: 'notify-pro', needsJob: true, needsPro: true },
      { type: 'job_declined', handler: 'notify-pro', needsJob: true, needsPro: true },
      { type: 'appointment_rescheduled', handler: 'send-sms', needsOrder: true },
      { type: 'on_my_way', handler: 'send-sms', needsJob: true },
      { type: 'appointment_reminder_24h', handler: 'send-sms', needsOrder: true },
      { type: 'day_before_reminder', handler: 'notify-pro', needsJob: true, needsPro: true },
      { type: 'morning_of_reminder', handler: 'notify-pro', needsJob: true, needsPro: true },
      { type: 'two_hour_reminder', handler: 'notify-pro', needsJob: true, needsPro: true },
      { type: 'job_completed_thank_you', handler: 'send-sms', needsJob: true },
      { type: 'payout_approved', handler: 'notify-pro', needsJob: true, needsPro: true }
    ];

    // Apply limit if provided
    const sequenceToFire = limit ? notificationSequence.slice(0, parseInt(limit)) : notificationSequence;

    const results = [];
    const isDryRun = mode === 'dryrun';

    // Log cooldown marker (only in live mode)
    if (!isDryRun) {
      await supabase.from('h2s_sms_log').insert({
        phone: managerSmsList[0] || 'debug',
        message: '[DEBUG] Fire all notifications started',
        status: 'sent',
        template_name: 'debug_fire_all',
        job_id: job_id || null
      });
    }

    // Fire each notification
    for (let i = 0; i < sequenceToFire.length; i++) {
      const notif = sequenceToFire[i];
      const stepResult = {
        step: i + 1,
        type: notif.type,
        handler: notif.handler,
        status: 'pending',
        recipients: { sms: [], email: [] },
        payload: null,
        error: null
      };

      try {
        // Use mock data if prerequisites not met (for testing)
        if (notif.needsJob && !jobData) {
          stepResult.status = 'skipped';
          stepResult.error = 'Missing job_id or job not found';
          results.push(stepResult);
          continue;
        }

        if (notif.needsPro && !proData) {
          stepResult.status = 'skipped';
          stepResult.error = 'Missing pro assignment or pro not found';
          results.push(stepResult);
          continue;
        }

        if (notif.needsOrder && !orderData) {
          stepResult.status = 'skipped';
          stepResult.error = 'Missing order_id or order not found';
          results.push(stepResult);
          continue;
        }

        // Build payload based on notification type
        let payload = {};
        let templateKey = notif.type;

        if (notif.handler === 'notify-pro') {
          payload = {
            job_id: jobData?.job_id || 'debug_test_job_123',
            pro_id: proData?.pro_id || 'debug_test_pro_123',
            type: notif.type,
            data: {
              customer_name: jobData.customer_name,
              service_name: jobData.service_name,
              service_type: jobData.service_type,
              service_address: jobData.service_address,
              service_city: jobData.service_city,
              service_state: jobData.service_state,
              service_zip: jobData.service_zip,
              customer_phone: jobData.customer_phone,
              customer_email: jobData.customer_email,
              notes_from_customer: jobData.notes_from_customer,
              start_iso: jobData.start_iso,
              end_iso: jobData.end_iso,
              amount: '150.00',
              jobId: jobData.job_id
            },
            debug: true,
            force_sms_to: managerSmsList.join(','),
            force_email_to: managerEmailList.join(',')
          };
        } else if (notif.handler === 'send-sms') {
          // Build SMS template data
          const smsData = {
            firstName: orderData.customer_name?.split(' ')[0] || 'Test',
            service: jobData.service_name || orderData.service_name,
            date: orderData.delivery_date || new Date(jobData.start_iso).toLocaleDateString(),
            time: orderData.delivery_time || new Date(jobData.start_iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            address: jobData.service_address,
            city: jobData.service_city,
            state: jobData.service_state,
            reviewUrl: `https://home2smart.com/review?order=${orderData.id || 'test123'}`
          };

          payload = {
            to: managerSmsList[0] || 'test',
            template_key: templateKey,
            template: templateKey,
            data: smsData,
            job_id: jobData.job_id || null,
            debug: true,
            force_to: managerSmsList.join(',')
          };
        }

        stepResult.payload = payload;
        stepResult.recipients.sms = managerSmsList;
        stepResult.recipients.email = managerEmailList;

        if (isDryRun) {
          stepResult.status = 'dryrun';
          results.push(stepResult);
          continue;
        }

        // Fire notification
        let apiResponse;
        if (notif.handler === 'notify-pro') {
          apiResponse = await fetch(`${baseUrl}/api/notify-pro`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        } else if (notif.handler === 'send-sms') {
          apiResponse = await fetch(`${baseUrl}/api/send-sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
        }

        const apiResult = await apiResponse.json();
        
        if (apiResponse.ok && (apiResult.ok !== false)) {
          stepResult.status = 'sent';
        } else {
          stepResult.status = 'failed';
          stepResult.error = apiResult.error || apiResult.message || 'Unknown error';
        }

        // Throttle: Wait 250-500ms between sends
        if (i < sequenceToFire.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 350));
        }

      } catch (err) {
        stepResult.status = 'failed';
        stepResult.error = err.message;
      }

      results.push(stepResult);
    }

    return res.json({
      ok: true,
      mode,
      timestamp: new Date().toISOString(),
      manager_allowlists: {
        sms: managerSmsList,
        email: managerEmailList
      },
      job_id: job_id || null,
      total_steps: sequenceToFire.length,
      results
    });

  } catch (error) {
    console.error('[DEBUG FIRE ALL] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}

