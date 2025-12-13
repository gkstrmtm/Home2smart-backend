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
    console.log('[portal_delete_artifact] Request received');
    
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const artifactId = body?.artifact_id || req.query?.artifact_id;
    
    console.log('[portal_delete_artifact] Artifact ID:', artifactId);

    const proId = await validateSession(token);
    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    if (!artifactId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing artifact_id',
        error_code: 'missing_data'
      });
    }

    // Get artifact details first - use actual schema: type, file_url, photo_url, url
    const { data: artifact, error: fetchError } = await supabase
      .from('h2s_dispatch_job_artifacts')
      .select('artifact_id, job_id, type, file_url, photo_url, url')
      .eq('artifact_id', artifactId)
      .single();

    if (fetchError || !artifact) {
      console.error('[portal_delete_artifact] Artifact not found:', fetchError);
      return res.status(404).json({
        ok: false,
        error: 'Artifact not found',
        error_code: 'not_found'
      });
    }

    // Extract storage path from URL
    const storageUrl = artifact.file_url || artifact.photo_url || artifact.url;
    const urlParts = storageUrl ? storageUrl.split('/job-artifacts/') : [];
    const storagePath = urlParts[1];

    if (storagePath) {
      // Delete from Supabase Storage
      const { error: storageError } = await supabase.storage
        .from('job-artifacts')
        .remove([storagePath]);

      if (storageError) {
        console.error('[portal_delete_artifact] Storage delete error:', storageError);
        // Continue anyway - we'll delete the DB record
      }
    }

    // Delete from database
    const { error: deleteError } = await supabase
      .from('h2s_dispatch_job_artifacts')
      .delete()
      .eq('artifact_id', artifactId);

    if (deleteError) {
      console.error('[portal_delete_artifact] DB delete error:', deleteError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to delete artifact',
        error_code: 'delete_error'
      });
    }

    // Update job photo count if it was a photo
    if (artifact.type === 'photo') {
      const { data: jobData } = await supabase
        .from('h2s_dispatch_jobs')
        .select('photo_count')
        .eq('job_id', artifact.job_id)
        .single();

      const currentCount = parseInt(jobData?.photo_count || 0);
      const newCount = Math.max(0, currentCount - 1);

      const { error: updateError } = await supabase
        .from('h2s_dispatch_jobs')
        .update({ 
          photo_count: newCount,
          photo_on_file: newCount > 0
        })
        .eq('job_id', artifact.job_id);

      if (updateError) {
        console.error('[portal_delete_artifact] Job update error:', updateError);
      }
    }

    console.log('[portal_delete_artifact] ✅ Artifact deleted successfully');

    return res.json({ 
      ok: true
    });

  } catch (error) {
    console.error('[portal_delete_artifact] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
