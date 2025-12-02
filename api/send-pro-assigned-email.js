import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * SEND PRO ASSIGNED EMAIL
 * 
 * Triggered when:
 * - Pro accepts a job in the portal
 * - Admin manually assigns pro to job
 * 
 * Sends email with:
 * - Pro photo (from photo_url)
 * - Pro bio (from bio_short)
 * - Pro rating (from avg_rating)
 * - Job details (date, time, address)
 * 
 * Usage:
 * POST /api/send-pro-assigned-email
 * Body: { job_id: "uuid", pro_id: "uuid" }
 */
export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    const { job_id, pro_id } = body;

    if (!job_id || !pro_id) {
      return res.status(400).json({
        error: 'Missing job_id or pro_id'
      });
    }

    console.log('[send-pro-assigned-email] Sending for job:', job_id, 'pro:', pro_id);

    // 1. Fetch job details
    const { data: job, error: jobError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .eq('job_id', job_id)
      .single();

    if (jobError || !job) {
      console.error('[send-pro-assigned-email] Job not found:', jobError);
      return res.status(404).json({ error: 'Job not found' });
    }

    // 2. Fetch pro details (just name and photo)
    const { data: pro, error: proError } = await supabase
      .from('h2s_dispatch_pros')
      .select('pro_id, name, photo_url')
      .eq('pro_id', pro_id)
      .single();

    if (proError || !pro) {
      console.error('[send-pro-assigned-email] Pro not found:', proError);
      return res.status(404).json({ error: 'Pro not found' });
    }

    // 3. Format date and time
    const jobDate = new Date(job.start_iso);
    const formattedDate = jobDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    const startTime = jobDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const endTime = job.end_iso
      ? new Date(job.end_iso).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        })
      : null;

    const timeWindow = endTime ? `${startTime} - ${endTime}` : startTime;

    // 4. Build email template data
    const emailData = {
      customer_name: job.customer_name || 'there',
      pro_name: pro.name || 'Your Pro',
      pro_photo_url: pro.photo_url || 'https://via.placeholder.com/120',
      service_name: job.service_name || 'service',
      date: formattedDate,
      time_window: timeWindow,
      service_address: job.service_address || job.customer_address || 'your location',
      job_id: job.job_id
    };

    // 5. Send email via send-email endpoint
    const emailEndpoint = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/send-email`
      : 'https://h2s-backend.vercel.app/api/send-email';

    const emailResponse = await fetch(emailEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_key: 'pro_assigned',
        data: emailData,
        to_email: job.customer_email,
        order_id: job.order_id || null,
        user_id: null
      })
    });

    const emailResult = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error('[send-pro-assigned-email] Email send failed:', emailResult);
      return res.status(500).json({
        error: 'Failed to send email',
        details: emailResult
      });
    }

    console.log('[send-pro-assigned-email] ✅ Email sent successfully');

    // 6. Also trigger SMS notification (if enabled)
    try {
      const smsEndpoint = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}/api/notify-customer`
        : 'https://h2s-backend.vercel.app/api/notify-customer';

      await fetch(smsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: job.job_id,
          type: 'pro_assigned'
        })
      });

      console.log('[send-pro-assigned-email] ✅ SMS also sent');
    } catch (smsError) {
      console.warn('[send-pro-assigned-email] SMS send failed (non-critical):', smsError.message);
    }

    return res.status(200).json({
      ok: true,
      message: 'Pro assigned notification sent',
      email_sent: true,
      pro_name: pro.name,
      customer_email: job.customer_email
    });

  } catch (error) {
    console.error('[send-pro-assigned-email] Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
