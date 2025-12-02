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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

    const { token, job_id } = body;

    console.log('[admin_job_delete] Request:', { job_id });

    // Validate admin session
    const isValid = await validateAdminSession(token);
    if (!isValid) {
      console.log('[admin_job_delete] Invalid or expired token');
      return res.status(401).json({
        ok: false,
        error: 'Not authorized',
        error_code: 'invalid_session'
      });
    }

    if (!job_id) {
      return res.status(400).json({
        ok: false,
        error: 'Missing job_id',
        error_code: 'missing_parameter'
      });
    }

    console.log('[admin_job_delete] ✅ Admin session valid, deleting job:', job_id);

    // Delete the job
    const { error: deleteError } = await supabase
      .from('h2s_dispatch_jobs')
      .delete()
      .eq('job_id', job_id);

    if (deleteError) {
      console.error('[admin_job_delete] Delete error:', deleteError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to delete job',
        error_code: 'delete_failed',
        details: deleteError.message
      });
    }

    console.log('[admin_job_delete] ✅ Job deleted:', job_id);

    return res.status(200).json({
      ok: true,
      job_id
    });

  } catch (error) {
    console.error('[admin_job_delete] Unexpected error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      error_code: 'internal_error',
      details: error.message
    });
  }
}
