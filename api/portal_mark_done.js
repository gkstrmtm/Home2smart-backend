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

    // Find the accepted assignment (with retry)
    let assignments;
    try {
      assignments = await retryWithBackoff(async () => {
        const { data, error } = await supabase
          .from('h2s_dispatch_job_assignments')
          .select('*')
          .eq('job_id', jobId)
          .eq('pro_id', proId)
          .eq('state', 'accepted')
          .single();
        
        if (error) throw error;
        return data;
      }, 3, 100);
    } catch (assignError) {
      console.error('Find assignment error:', assignError);
      return res.status(404).json({
        ok: false,
        error: 'Assignment not found or not in accepted state',
        error_code: 'assignment_not_found'
      });
    }

    // Mark as completed (with retry)
    try {
      await retryWithBackoff(async () => {
        const { error } = await supabase
          .from('h2s_dispatch_job_assignments')
          .update({
            state: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('assign_id', assignments.assign_id);
        
        if (error) throw error;
      }, 3, 100);
    } catch (updateError) {
      console.error('Failed to mark done:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to mark done. Please try again.',
        error_code: 'db_error'
      });
    }

    // Update job status
    await supabase
      .from('h2s_dispatch_jobs')
      .update({ status: 'completed' })
      .eq('job_id', jobId);

    // TODO: Trigger customer review email via Apps Script webhook
    // For now, emails still handled by Apps Script background triggers

    return res.json({ ok: true });

  } catch (error) {
    console.error('Mark done error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
