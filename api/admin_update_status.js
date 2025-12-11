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

async function validateAdminSession(token) {
  if (!token) return false;
  
  // Try session_id first (primary)
  let { data, error } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('admin_email')
    .eq('session_id', token)
    .gte('expires_at', new Date().toISOString())
    .single();

  // Fallback to token field (backwards compatibility)
  if (error || !data) {
    const res = await supabase
      .from('h2s_dispatch_admin_sessions')
      .select('admin_email')
      .eq('token', token)
      .gte('expires_at', new Date().toISOString())
      .single();
    
    data = res.data;
    error = res.error;
  }

  if (error || !data) return false;
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

    const { token, job_id, status } = body;

    if (!job_id || !status) {
      return res.status(400).json({ ok: false, error: 'Missing job_id or status' });
    }

    const isValid = await validateAdminSession(token);
    if (!isValid) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    // Update job status
    const { error } = await supabase
      .from('h2s_dispatch_jobs')
      .update({ 
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('job_id', job_id);

    if (error) throw error;

    return res.status(200).json({ ok: true, job_id, status });

  } catch (error) {
    console.error('Error updating job status:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
