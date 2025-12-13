import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { token, job_id } = req.body;
    
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Missing admin token' });
    }

    if (!job_id) {
      return res.status(400).json({ ok: false, error: 'Missing job_id' });
    }

    // Validate admin session
    const { data: session } = await supabase
      .from('h2s_dispatch_admin_sessions')
      .select('session_id, expires_at')
      .eq('session_id', token)
      .single();

    if (!session || new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired admin token' });
    }

    // Fetch artifacts for this job
    const { data: artifacts, error: artifactsError } = await supabase
      .from('h2s_dispatch_job_artifacts')
      .select('*')
      .eq('job_id', job_id)
      .order('created_at', { ascending: false });

    if (artifactsError) {
      console.error('[admin_job_artifacts] Error:', artifactsError);
      return res.status(500).json({ 
        ok: false, 
        error: 'Failed to fetch artifacts',
        details: artifactsError.message 
      });
    }

    // Separate by type
    const photos = (artifacts || []).filter(a => String(a.type).toLowerCase() === 'photo');
    const signatures = (artifacts || []).filter(a => String(a.type).toLowerCase() === 'signature');

    console.log('[admin_job_artifacts] Job:', job_id, 'Photos:', photos.length, 'Signatures:', signatures.length);

    return res.status(200).json({
      ok: true,
      job_id,
      artifacts: artifacts || [],
      photos,
      signatures
    });

  } catch (err) {
    console.error('[admin_job_artifacts] Exception:', err);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error',
      details: err.message 
    });
  }
}
