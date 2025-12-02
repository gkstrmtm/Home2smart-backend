import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function validateSession(token) {
  if (!token) return null;
  
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    console.log(`[${requestId}] ==================== START ====================`);
    console.log(`[${requestId}] Method:`, req.method);
    
    // Parse body
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error(`[${requestId}] JSON parse error:`, e);
        return res.status(400).json({
          ok: false,
          error: 'Invalid JSON in request body',
          error_code: 'parse_error'
        });
      }
    }
    
    const token = body?.token || req.query?.token;
    const jobId = body?.job_id || req.query?.job_id;
    const artifactType = body?.type || req.query?.type || 'photo';
    
    console.log(`[${requestId}] token:`, token ? `${token.substring(0, 15)}...` : 'MISSING');
    console.log(`[${requestId}] job_id:`, jobId);
    console.log(`[${requestId}] type:`, artifactType);

    // Validate session
    const proId = await validateSession(token);
    if (!proId) {
      console.error(`[${requestId}] ❌ Session invalid`);
      return res.status(401).json({
        ok: false,
        error: 'Invalid or expired session',
        error_code: 'bad_session'
      });
    }
    
    console.log(`[${requestId}] ✓ Session valid - pro_id:`, proId);

    if (!jobId) {
      console.error(`[${requestId}] ❌ Missing job_id`);
      return res.status(400).json({
        ok: false,
        error: 'job_id is required',
        error_code: 'missing_job_id'
      });
    }

    // Query artifacts
    console.log(`[${requestId}] Querying artifacts...`);
    
    const { data: rawArtifacts, error: queryError } = await supabase
      .from('h2s_dispatch_job_artifacts')
      .select('artifact_id, job_id, type, file_url, photo_url, url, created_at, added_at, note, caption, pro_id')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(100);

    if (queryError) {
      console.error(`[${requestId}] ❌ Query failed:`, queryError);
      return res.status(500).json({
        ok: false,
        error: 'Database query failed',
        error_code: 'query_error',
        details: queryError.message
      });
    }

    console.log(`[${requestId}] ✓ Fetched ${rawArtifacts?.length || 0} total artifacts`);

    // Filter by type and ensure valid URL
    const artifacts = (rawArtifacts || [])
      .filter(a => {
        const typeMatches = String(a.type || '').toLowerCase() === String(artifactType).toLowerCase();
        const hasUrl = !!(a.file_url || a.photo_url || a.url);
        if (!typeMatches) console.log(`[${requestId}]   Skip: wrong type (${a.type} != ${artifactType})`);
        if (!hasUrl) console.log(`[${requestId}]   Skip: no URL`);
        return typeMatches && hasUrl;
      })
      .map(a => ({
        artifact_id: a.artifact_id,
        job_id: a.job_id,
        artifact_type: a.type || 'photo',
        storage_url: a.file_url || a.photo_url || a.url,
        uploaded_at: a.created_at || a.added_at,
        note: a.note || null,
        caption: a.caption || null,
        pro_id: a.pro_id || null
      }));

    console.log(`[${requestId}] ✓ Filtered to ${artifacts.length} ${artifactType}(s)`);
    
    if (artifacts.length > 0) {
      console.log(`[${requestId}] Sample:`, artifacts[0].artifact_id.substring(0,8), artifacts[0].storage_url.substring(0,60));
    }

    console.log(`[${requestId}] ==================== SUCCESS ====================`);

    return res.json({ 
      ok: true,
      artifacts,
      count: artifacts.length,
      job_id: jobId
    });

  } catch (error) {
    console.error(`[${requestId}] ❌❌❌ FATAL:`, error.message);
    console.error(`[${requestId}] Stack:`, error.stack);
    
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      error_code: 'server_error',
      message: error.message
    });
  }
}
