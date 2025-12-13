import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Reschedule an existing appointment
 * Can be called from:
 * - Customer portal (future feature)
 * - Admin portal
 * - Automated flow after RESCHEDULE SMS reply
 */
export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) {}
    }

    const { 
      order_id,
      delivery_date,      // New date
      delivery_time,      // New time
      reason              // Optional: "Customer requested", "Weather delay", etc.
    } = body;

    if (!order_id) {
      return res.status(400).json({ ok: false, error: 'Missing order_id' });
    }
    if (!delivery_date || !delivery_time) {
      return res.status(400).json({ ok: false, error: 'Missing new delivery_date or delivery_time' });
    }

    console.log(`[Reschedule] Rescheduling Order ${order_id} to ${delivery_date} at ${delivery_time}`);

    // 1. Get existing order
    const { data: order, error: orderError } = await supabase
      .from('h2s_orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Store old date/time for notification
    const oldDate = order.delivery_date;
    const oldTime = order.delivery_time;

    // 2. Update order with new appointment
    const { error: updateError } = await supabase
      .from('h2s_orders')
      .update({
        delivery_date: delivery_date,
        delivery_time: delivery_time,
        needs_reschedule: false, // Clear reschedule flag
        appointment_confirmed: false, // Customer needs to confirm new time
        updated_at: new Date().toISOString()
      })
      .eq('id', order_id);

    if (updateError) {
      console.error('[Reschedule] Update failed:', updateError);
      return res.status(500).json({ ok: false, error: updateError.message });
    }

    console.log(`[Reschedule] ✅ Order ${order_id} rescheduled`);

    // 3. Send "appointment_rescheduled" notifications
    const firstName = (order.customer_name || '').split(' ')[0] || 'Customer';
    const notificationData = {
      firstName: firstName,
      service: order.service_name || 'service',
      oldDate: formatDate(oldDate),
      oldTime: oldTime,
      date: formatDate(delivery_date),
      time: delivery_time,
      reason: reason || 'at your request'
    };

    // Duplicate prevention: Check if reschedule notification already sent recently
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: recentEmail } = await supabase
      .from('email_messages')
      .select('id')
      .eq('order_id', order_id)
      .eq('message_type', 'appointment_rescheduled')
      .gte('sent_at', twoMinutesAgo)
      .limit(1);

    const shouldSend = !recentEmail || recentEmail.length === 0;

    // Send SMS
    if (shouldSend && order.customer_phone && process.env.TWILIO_ENABLED !== 'false') {
      try {
        const smsResponse = await fetch(`${getBaseUrl(req)}/api/send-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: order.customer_phone,
            template_key: 'appointment_rescheduled',
            data: notificationData,
            order_id: order_id
          })
        });
        const smsResult = await smsResponse.json();
        if (smsResult.ok) {
          console.log(`[Reschedule] ✅ SMS sent`);
        }
      } catch (err) {
        console.error('[Reschedule] SMS error:', err);
      }
    } else if (!shouldSend) {
      console.log('[Reschedule] ⏭️ Skipping duplicate notification (sent within last 2 minutes)');
    }

    // Send Email
    if (shouldSend && order.customer_email && process.env.SENDGRID_ENABLED !== 'false') {
      try {
        const emailResponse = await fetch(`${getBaseUrl(req)}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: order.customer_email,
            template_key: 'appointment_rescheduled',
            data: notificationData,
            order_id: order_id
          })
        });
        const emailResult = await emailResponse.json();
        if (emailResult.ok) {
          console.log(`[Reschedule] ✅ Email sent`);
        }
      } catch (err) {
        console.error('[Reschedule] Email error:', err);
      }
    }

    // 4. Update dispatch job if it exists
    let jobId = null;
    try {
      const { data: job } = await supabase
        .from('h2s_dispatch_jobs')
        .select('job_id')
        .eq('order_id', order_id)
        .single();
      
      if (job) {
        jobId = job.job_id;
        await supabase
          .from('h2s_dispatch_jobs')
          .update({
            start_iso: `${delivery_date}T${convertTo24Hour(delivery_time)}:00`,
            status: 'scheduled',
            updated_at: new Date().toISOString()
          })
          .eq('order_id', order_id);
        console.log('[Reschedule] ✅ Dispatch job updated');
      }
    } catch (err) {
      console.warn('[Reschedule] Dispatch job update failed (non-critical):', err);
    }

    // 5. Notify assigned tech if job exists and has accepted assignment
    if (jobId) {
      try {
        const { data: assignment } = await supabase
          .from('h2s_dispatch_job_assignments')
          .select('pro_id')
          .eq('job_id', jobId)
          .eq('state', 'accepted')
          .single();
        
        if (assignment?.pro_id) {
          const { data: proData } = await supabase
            .from('h2s_pros')
            .select('name, phone, email')
            .eq('pro_id', assignment.pro_id)
            .single();

          if (proData) {
            const notifyEndpoint = process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}/api/notify-pro`
              : 'https://h2s-backend.vercel.app/api/notify-pro';
            
            await fetch(notifyEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                job_id: jobId,
                pro_id: assignment.pro_id,
                type: 'job_rescheduled',
                data: {
                  old_date: formatDate(oldDate),
                  old_time: oldTime,
                  new_date: formatDate(delivery_date),
                  new_time: delivery_time,
                  reason: reason || 'Customer request'
                }
              })
            });
            console.log('[Reschedule] ✅ Tech notified');
          }
        }
      } catch (notifyErr) {
        console.warn('[Reschedule] Tech notification failed (non-critical):', notifyErr.message);
      }
    }

    return res.json({ 
      ok: true, 
      message: 'Appointment rescheduled successfully',
      old_date: oldDate,
      old_time: oldTime,
      new_date: delivery_date,
      new_time: delivery_time
    });

  } catch (error) {
    console.error('[Reschedule] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });
  } catch (e) {
    return dateStr;
  }
}

function convertTo24Hour(time12h) {
  try {
    const [time, modifier] = time12h.split(' ');
    let [hours, minutes] = time.split(':');
    if (hours === '12') hours = '00';
    if (modifier?.toUpperCase() === 'PM') hours = parseInt(hours, 10) + 12;
    return `${hours}:${minutes || '00'}`;
  } catch (e) {
    return '12:00';
  }
}
