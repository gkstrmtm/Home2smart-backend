import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Verify this is a cron request (Vercel adds this header)
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Get tomorrow's date in YYYY-MM-DD format
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0];

    console.log('[Send Reminders] Looking for orders on:', tomorrowDate);

    // Find orders scheduled for tomorrow that haven't received a reminder
    const { data: orders, error } = await supabase
      .from('h2s_orders')
      .select('*')
      .eq('delivery_date', tomorrowDate)
      .in('status', ['paid', 'scheduled'])
      .neq('last_sms_type', 'appointment_reminder_24h')
      .not('customer_phone', 'is', null);

    if (error) {
      console.error('[Send Reminders] Query error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    console.log('[Send Reminders] Found', orders?.length || 0, 'orders');

    if (!orders || orders.length === 0) {
      return res.status(200).json({ 
        ok: true, 
        sent: 0, 
        message: 'No reminders to send' 
      });
    }

    const results = [];

    for (const order of orders) {
      try {
        const firstName = (order.customer_name || '').split(' ')[0] || 'there';
        const reminderData = {
          firstName,
          service: order.service_name || 'your service',
          date: order.delivery_date,
          time: order.delivery_time || 'TBD'
        };
        
        // Send SMS reminder
        if (order.customer_phone) {
          const smsResponse = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://h2s-backend.vercel.app'}/api/send-sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: order.customer_phone,
              template_key: 'appointment_reminder_24h',
              data: reminderData,
              order_id: order.id
            })
          });

          const smsResult = await smsResponse.json();
          if (!smsResult.ok) {
            console.error('[Send Reminders] SMS failed for order:', order.id, smsResult.error);
          }
        }

        // Send email reminder
        if (order.customer_email) {
          const emailResponse = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://h2s-backend.vercel.app'}/api/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to_email: order.customer_email,
              template_key: 'appointment_reminder_24h',
              data: reminderData,
              order_id: order.id
            })
          });

          const emailResult = await emailResponse.json();
          if (!emailResult.ok) {
            console.error('[Send Reminders] Email failed for order:', order.id, emailResult.error);
          }
        }

        results.push({ order_id: order.id, status: 'sent' });
        console.log('[Send Reminders] Sent reminders for order:', order.id);
        
      } catch (err) {
        results.push({ order_id: order.id, status: 'error', error: err.message });
        console.error('[Send Reminders] Error for order:', order.id, err);
      }
    }

    const successCount = results.filter(r => r.status === 'sent').length;

    return res.status(200).json({
      ok: true,
      sent: successCount,
      total: orders.length,
      results
    });

  } catch (error) {
    console.error('[Send Reminders] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
