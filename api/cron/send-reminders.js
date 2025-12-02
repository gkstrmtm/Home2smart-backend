import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * CRON JOB: Send 24-hour appointment reminders
 * Runs daily at 10:00 AM EST
 * Queries orders with appointments tomorrow
 * Sends reminder SMS + Email
 */
export default async function handler(req, res) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.authorization || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn('[Cron/Reminders] Unauthorized access attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[Cron/Reminders] Starting reminder job...');

  try {
    // Calculate tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateString = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD

    console.log(`[Cron/Reminders] Looking for appointments on: ${tomorrowDateString}`);

    // Query orders with appointments tomorrow
    const { data: orders, error } = await supabase
      .from('h2s_orders')
      .select('*')
      .eq('delivery_date', tomorrowDateString)
      .not('delivery_time', 'is', null)
      .eq('status', 'paid')
      .is('reminder_sent_at', null); // Only send once

    if (error) {
      console.error('[Cron/Reminders] Query failed:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!orders || orders.length === 0) {
      console.log('[Cron/Reminders] No appointments found for tomorrow');
      return res.json({ ok: true, sent: 0, message: 'No reminders to send' });
    }

    console.log(`[Cron/Reminders] Found ${orders.length} appointments to remind`);

    let sentSMS = 0;
    let sentEmail = 0;
    let failed = 0;

    // Send reminders for each order
    for (const order of orders) {
      const firstName = (order.customer_name || '').split(' ')[0] || 'Customer';
      const reminderData = {
        firstName: firstName,
        service: order.service_name || 'service',
        date: formatDate(order.delivery_date),
        time: order.delivery_time,
        address: `${order.service_city || ''}, ${order.service_state || 'SC'}`
      };

      // Send SMS reminder
      if (order.customer_phone && process.env.TWILIO_ENABLED === 'true') {
        try {
          const smsResponse = await fetch(`${getBaseUrl(req)}/api/send-sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: order.customer_phone,
              template_key: 'appointment_reminder',
              data: reminderData,
              order_id: order.order_id
            })
          });

          const smsResult = await smsResponse.json();
          if (smsResult.ok) {
            sentSMS++;
            console.log(`[Cron/Reminders] ✅ SMS sent to ${order.customer_phone}`);
          } else {
            console.warn(`[Cron/Reminders] SMS failed for ${order.customer_phone}:`, smsResult.error);
            failed++;
          }
        } catch (err) {
          console.error('[Cron/Reminders] SMS error:', err);
          failed++;
        }
      }

      // Send Email reminder
      if (order.customer_email && process.env.SENDGRID_ENABLED !== 'false') {
        try {
          const emailResponse = await fetch(`${getBaseUrl(req)}/api/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: order.customer_email,
              template_key: 'appointment_reminder',
              data: reminderData,
              order_id: order.order_id
            })
          });

          const emailResult = await emailResponse.json();
          if (emailResult.ok) {
            sentEmail++;
            console.log(`[Cron/Reminders] ✅ Email sent to ${order.customer_email}`);
          } else {
            console.warn(`[Cron/Reminders] Email failed for ${order.customer_email}:`, emailResult.error);
            failed++;
          }
        } catch (err) {
          console.error('[Cron/Reminders] Email error:', err);
          failed++;
        }
      }

      // Mark reminder as sent
      await supabase
        .from('h2s_orders')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('order_id', order.order_id);
    }

    console.log(`[Cron/Reminders] ✅ Complete: ${sentSMS} SMS, ${sentEmail} emails sent. ${failed} failed.`);

    return res.json({ 
      ok: true, 
      sent: sentSMS + sentEmail,
      sms: sentSMS,
      email: sentEmail,
      failed: failed,
      date: tomorrowDateString
    });

  } catch (error) {
    console.error('[Cron/Reminders] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

// Helper: Get base URL for internal API calls
function getBaseUrl(req) {
  // In cron context, we need to use the deployment URL
  return process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}`
    : 'https://h2s-backend-robgbyphx-tabari-ropers-projects-6f2e090b.vercel.app';
}

// Helper: Format date for display
function formatDate(dateStr) {
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
