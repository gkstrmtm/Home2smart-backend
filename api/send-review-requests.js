import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Verify this is a cron request
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Find orders completed in the last 24 hours that haven't received a review request
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    console.log('[Send Reviews] Looking for orders completed since:', yesterday.toISOString());

    const { data: orders, error } = await supabase
      .from('h2s_orders')
      .select('*')
      .eq('status', 'completed')
      .neq('last_sms_type', 'review_request')
      .gte('updated_at', yesterday.toISOString())
      .not('customer_phone', 'is', null);

    if (error) {
      console.error('[Send Reviews] Query error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    console.log('[Send Reviews] Found', orders?.length || 0, 'completed orders');

    if (!orders || orders.length === 0) {
      return res.status(200).json({ 
        ok: true, 
        sent: 0, 
        message: 'No review requests to send' 
      });
    }

    const results = [];

    for (const order of orders) {
      try {
        const firstName = (order.customer_name || '').split(' ')[0] || 'there';
        const reviewData = {
          firstName,
          service: order.service_name || 'service',
          reviewLink: 'https://home2smart.com/reviews'
        };
        
        // Send SMS review request
        if (order.customer_phone) {
          const smsResponse = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://h2s-backend.vercel.app'}/api/send-sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: order.customer_phone,
              template_key: 'review_request',
              data: reviewData,
              order_id: order.id
            })
          });

          const smsResult = await smsResponse.json();
          if (!smsResult.ok) {
            console.error('[Send Reviews] SMS failed for order:', order.id, smsResult.error);
          }
        }

        // Send email review request
        if (order.customer_email) {
          const emailResponse = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://h2s-backend.vercel.app'}/api/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to_email: order.customer_email,
              template_key: 'review_request',
              data: reviewData,
              order_id: order.id
            })
          });

          const emailResult = await emailResponse.json();
          if (!emailResult.ok) {
            console.error('[Send Reviews] Email failed for order:', order.id, emailResult.error);
          }
        }

        results.push({ order_id: order.id, status: 'sent' });
        console.log('[Send Reviews] Sent review requests for order:', order.id);
        
      } catch (err) {
        results.push({ order_id: order.id, status: 'error', error: err.message });
        console.error('[Send Reviews] Error for order:', order.id, err);
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
    console.error('[Send Reviews] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
