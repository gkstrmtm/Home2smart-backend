import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * Validate admin session
 */
async function validateAdminSession(token) {
  if (!token) return false;
  
  const { data, error } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('admin_email')
    .eq('session_id', token)
    .gte('expires_at', new Date().toISOString())
    .single();

  if (error || !data) return false;
  
  // Update last_seen_at
  await supabase
    .from('h2s_dispatch_admin_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', token);
  
  return true;
}

export default async function handler(req, res) {
  // CORS
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

    const { token, status, days = 14 } = body;

    console.log('[admin_jobs_list] Request:', { status, days });

    // Validate admin session
    const isValid = await validateAdminSession(token);
    if (!isValid) {
      console.log('[admin_jobs_list] Invalid or expired token');
      return res.status(401).json({
        ok: false,
        error: 'Not authorized',
        error_code: 'invalid_session'
      });
    }

    console.log('[admin_jobs_list] ✅ Admin session valid');

    // Calculate cutoff date
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Build query
    let query = supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .gte('created_at', cutoffDate)
      .order('start_iso', { ascending: false });

    // Filter by status if provided
    if (status) {
      query = query.eq('status', status.toLowerCase());
    }

    const { data: jobs, error: jobsError } = await query;

    if (jobsError) {
      console.error('[admin_jobs_list] Jobs query error:', jobsError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch jobs',
        error_code: 'query_failed',
        details: jobsError.message
      });
    }

    console.log('[admin_jobs_list] ✅ Found', jobs.length, 'jobs');

    // Format jobs for frontend
    const formattedJobs = jobs.map(job => ({
      job_id: job.job_id,
      status: job.status || '',
      service_id: job.service_id || '',
      service_name: job.service_name || job.service_id || '',
      customer_name: job.customer_name || '',
      customer_email: job.customer_email || '',
      address: job.service_address || '',
      city: job.service_city || '',
      state: job.service_state || '',
      zip: job.service_zip || '',
      start_iso: job.start_iso || '',
      end_iso: job.end_iso || '',
      variant_code: job.variant_code || '',
      resources_needed: job.resources_needed || '',
      option_id: job.option_id || '',
      qty: job.qty || 1,
      line_items_json: job.line_items_json || null,
      created_at: job.created_at
    }));

    return res.status(200).json({
      ok: true,
      jobs: formattedJobs
    });

  } catch (error) {
    console.error('[admin_jobs_list] Unexpected error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      error_code: 'internal_error',
      details: error.message
    });
  }
}
