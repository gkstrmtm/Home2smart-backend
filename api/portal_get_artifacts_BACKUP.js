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
    console.log('[portal_get_artifacts] ========================================');
    console.log('[portal_get_artifacts] Request received');
    console.log('[portal_get_artifacts] Method:', req.method);
    console.log('[portal_get_artifacts] Headers:', JSON.stringify(req.headers, null, 2));
    
    // Check environment variables first
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[portal_get_artifacts] ❌ Missing Supabase credentials!');
      console.error('[portal_get_artifacts] SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
      console.error('[portal_get_artifacts] SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING');
      return res.status(500).json({
        ok: false,
        error: 'Server configuration error',
        error_code: 'missing_credentials'
      });
    }
    
    // Support both GET (query params) and POST (body)
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (parseErr) {
        console.error('[portal_get_artifacts] JSON parse error:', parseErr);
        body = {};
      }
    }
    
    const token = body?.token || req.query?.token;
    const jobId = body?.job_id || req.query?.job_id;
    const artifactType = body?.type || req.query?.type || 'photo';
    
    console.log('[portal_get_artifacts] Token:', token ? `${token.substring(0, 20)}...` : 'MISSING');
    console.log('[portal_get_artifacts] Job:', jobId);
    console.log('[portal_get_artifacts] Type:', artifactType);

    const proId = await validateSession(token);
    console.log('[portal_get_artifacts] Validated pro_id:', proId);
    
    if (!proId) {
      console.error('[portal_get_artifacts] ❌ Session validation failed');
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    if (!jobId) {
      console.error('[portal_get_artifacts] ❌ Missing job_id parameter');
      return res.status(400).json({
        ok: false,
        error: 'Missing job_id',
        error_code: 'missing_data'
      });
    }

    console.log('[portal_get_artifacts] Querying h2s_dispatch_job_artifacts...');
    console.log('[portal_get_artifacts] Query params - job_id:', jobId, 'artifact_type:', artifactType);

    // Relaxed query: fetch by job_id only to avoid schema mismatch causing 500
    let rawArtifacts = null;
    let rawError = null;
    
    // Attempt 1: order by created_at (new schema)
    try {
      const q1 = await supabase
        .from('h2s_dispatch_job_artifacts')
        .select('*')
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(200);
      rawArtifacts = q1.data;
      rawError = q1.error;
    } catch (e) {
      rawError = e;
    }
    
    // Attempt 2: fallback order by added_at (legacy schema)
    if (rawError) {
      console.warn('[portal_get_artifacts] ⚠️ Fallback to added_at due to error:', rawError);
      try {
        const q2 = await supabase
          .from('h2s_dispatch_job_artifacts')
          .select('*')
          .eq('job_id', jobId)
          .order('added_at', { ascending: false })
          .limit(200);
        rawArtifacts = q2.data;
        rawError = q2.error;
      } catch (e2) {
        rawError = e2;
      }
    }
    
    // Attempt 3: no order at all
    if (rawError) {
      console.warn('[portal_get_artifacts] ⚠️ Fallback to no order due to error:', rawError);
      try {
        const q3 = await supabase
          .from('h2s_dispatch_job_artifacts')
          .select('*')
          .eq('job_id', jobId)
          .limit(200);
        rawArtifacts = q3.data;
        rawError = q3.error;
      } catch (e3) {
        rawError = e3;
      }
    }

    if (rawError) {
      console.error('[portal_get_artifacts] ❌ Supabase raw query error:', rawError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch artifacts',
        error_code: 'query_error',
        details: String(rawError?.message || rawError)
      });
    }

    console.log('[portal_get_artifacts] Raw fetch count:', rawArtifacts?.length || 0);

    // Map to frontend-expected format - table uses type, file_url, photo_url, url
    const mappedArtifacts = (rawArtifacts || [])
    // Filter by type in code - table uses 'type' not 'artifact_type'
    .filter(a => {
      const t = a.type || a.artifact_type || 'photo';
      return String(t).toLowerCase() === String(artifactType).toLowerCase();
    })
    .map(a => ({
      artifact_id: a.artifact_id,
      job_id: a.job_id,
      artifact_type: a.type || a.artifact_type || 'photo',
      storage_url: a.file_url || a.photo_url || a.url || a.storage_url || '',
      uploaded_at: a.created_at || a.added_at || a.uploaded_at || null,
      note: a.note || null,
      caption: a.caption || null
    }))
    // Filter out records without any usable URL
    .filter(m => !!m.storage_url);
    
    console.log('[portal_get_artifacts] Filtered and mapped:', mappedArtifacts.length, 'artifacts');
    if (mappedArtifacts.length > 0) {
      console.log('[portal_get_artifacts] Sample artifact:', JSON.stringify(mappedArtifacts[0], null, 2));
    }

    console.log('[portal_get_artifacts] ✅ Found', mappedArtifacts.length, 'artifacts');
    console.log('[portal_get_artifacts] ========================================');

    return res.json({ 
      ok: true,
      artifacts: mappedArtifacts
    });

  } catch (error) {
    console.error('[portal_get_artifacts] ❌❌❌ FATAL ERROR ❌❌❌');
    console.error('[portal_get_artifacts] Error name:', error.name);
    console.error('[portal_get_artifacts] Error message:', error.message);
    console.error('[portal_get_artifacts] Error stack:', error.stack);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error',
      error_name: error.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
