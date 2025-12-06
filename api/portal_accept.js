import { createClient } from '@supabase/supabase-js';

// Retry helper inline
async function retryWithBackoff(fn, maxAttempts = 3, delayMs = 100) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error.code && error.code >= 400 && error.code < 500) throw error;
      if (attempt === maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: { bodyParser: true },
};

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
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const jobId = body?.job_id || req.query?.job_id;
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
        error_code: 'missing_job'
      });
    }

    // Check if assignment already exists (handle potential duplicates by taking newest)
    const { data: existingAssignments } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('*')
      .eq('job_id', jobId)
      .eq('pro_id', proId)
      .order('created_at', { ascending: false })
      .limit(1);

    const existingAssignment = existingAssignments && existingAssignments.length > 0 ? existingAssignments[0] : null;

    // Get job details to calculate distance
    const { data: job } = await supabase
      .from('h2s_dispatch_jobs')
      .select('geo_lat, geo_lng')
      .eq('job_id', jobId)
      .single();

    // Get tech coords
    const { data: tech } = await supabase
      .from('h2s_pros')
      .select('geo_lat, geo_lng')
      .eq('pro_id', proId)
      .single();

    let distanceMiles = null;
    if (job && tech && job.geo_lat && job.geo_lng && tech.geo_lat && tech.geo_lng) {
      const lat1 = parseFloat(job.geo_lat);
      const lng1 = parseFloat(job.geo_lng);
      const lat2 = parseFloat(tech.geo_lat);
      const lng2 = parseFloat(tech.geo_lng);
      
      const R = 3959; // Earth radius in miles
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      distanceMiles = Math.round(R * c * 100) / 100;
    }

    if (existingAssignment) {
      // Update existing assignment
      const { error: updateError } = await supabase
        .from('h2s_dispatch_job_assignments')
        .update({
          state: 'accepted',
          accepted_at: new Date().toISOString()
        })
        .eq('assign_id', existingAssignment.assign_id);

      if (updateError) {
        console.error('Failed to update assignment:', updateError);
        return res.status(500).json({
          ok: false,
          error: 'Failed to accept offer',
          error_code: 'db_error'
        });
      }
    } else {
      // Create new assignment
      console.log('[portal_accept] Creating new assignment for job:', jobId, 'pro:', proId);
      const { error: insertError } = await supabase
        .from('h2s_dispatch_job_assignments')
        .insert({
          job_id: jobId,
          pro_id: proId,
          state: 'accepted',
          distance_miles: distanceMiles,
          offer_sent_at: new Date().toISOString(),
          accepted_at: new Date().toISOString()
        });

      if (insertError) {
        console.error('Failed to create assignment:', insertError);
        return res.status(500).json({
          ok: false,
          error: 'Failed to accept job: ' + insertError.message,
          error_code: 'db_error',
          details: insertError
        });
      }
      console.log('[portal_accept] ✅ Assignment created successfully');
    }

    // Update job status from pending_assign to accepted
    console.log('[portal_accept] Updating job status to accepted');
    const { error: jobUpdateError } = await supabase
      .from('h2s_dispatch_jobs')
      .update({ status: 'accepted' })
      .eq('job_id', jobId);

    if (jobUpdateError) {
      console.error('[portal_accept] Warning: Failed to update job status:', jobUpdateError);
    }

    console.log('[portal_accept] ✅ Job accepted successfully');

    // Send pro_assigned email to customer (with pro photo and bio)
    try {
      const emailEndpoint = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}/api/send-pro-assigned-email`
        : 'https://h2s-backend.vercel.app/api/send-pro-assigned-email';

      console.log('[portal_accept] Sending pro_assigned email...');
      
      const emailResponse = await fetch(emailEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          pro_id: proId
        })
      });

      if (emailResponse.ok) {
        console.log('[portal_accept] ✅ Pro assigned email sent');
      } else {
        const errorText = await emailResponse.text();
        console.warn('[portal_accept] Email send failed (non-critical):', errorText);
      }
    } catch (emailError) {
      console.warn('[portal_accept] Email send error (non-critical):', emailError.message);
    }

    return res.json({ ok: true });

  } catch (error) {
    console.error('[portal_accept] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
