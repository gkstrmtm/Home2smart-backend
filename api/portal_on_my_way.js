import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    console.log('[portal_on_my_way] Request received');
    
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const jobId = body?.job_id || req.query?.job_id;
    
    console.log('[portal_on_my_way] Job:', jobId);

    // Validate session
    const proId = await validateSession(token);
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
        error_code: 'missing_data'
      });
    }

    // Verify this pro is assigned to this job
    const { data: job, error: jobError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('job_id, order_id, status, customer_name, customer_email, customer_phone')
      .eq('job_id', jobId)
      .eq('assigned_pro_id', proId)
      .single();

    if (jobError || !job) {
      console.error('[portal_on_my_way] Job not found or not assigned:', jobError);
      return res.status(404).json({
        ok: false,
        error: 'Job not found or not assigned to you',
        error_code: 'job_not_found'
      });
    }

    // Update job status to "en_route"
    const { error: updateError } = await supabase
      .from('h2s_dispatch_jobs')
      .update({
        tech_en_route_at: new Date().toISOString(),
        status: 'en_route'
      })
      .eq('job_id', jobId);

    if (updateError) {
      console.error('[portal_on_my_way] Update error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to update status',
        error_code: 'update_error'
      });
    }

    console.log('[portal_on_my_way] ✅ Status updated to en_route');

    // Send SMS notification to customer
    if (job.customer_phone && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      try {
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
        const customerName = job.customer_name || 'Customer';
        const message = `Hi ${customerName}! Your Home2Smart technician is on the way to your location. See you soon! 🚗`;
        
        const response = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
          },
          body: new URLSearchParams({
            From: process.env.TWILIO_PHONE_NUMBER,
            To: job.customer_phone,
            Body: message
          })
        });
        
        if (response.ok) {
          console.log('[portal_on_my_way] ✅ SMS sent to customer:', job.customer_phone);
        } else {
          const errorData = await response.json();
          console.error('[portal_on_my_way] ❌ SMS failed:', errorData);
        }
      } catch (smsError) {
        console.error('[portal_on_my_way] SMS error:', smsError);
        // Don't fail the whole request if SMS fails
      }
    }

    return res.json({ 
      ok: true,
      message: 'Status updated and customer notified'
    });

  } catch (error) {
    console.error('[portal_on_my_way] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
