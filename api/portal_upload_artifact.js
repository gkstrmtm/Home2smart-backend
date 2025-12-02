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
    console.log('[portal_upload_artifact] Request received');
    
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const jobId = body?.job_id || req.query?.job_id;
    const artifactType = body?.type || 'photo';
    const base64Data = body?.data;
    const filename = body?.filename || `${artifactType}_${jobId}_${Date.now()}.jpg`;
    const mimetype = body?.mimetype || 'image/jpeg';
    
    console.log('[portal_upload_artifact] Job:', jobId, 'Type:', artifactType, 'Filename:', filename);

    const proId = await validateSession(token);
    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    if (!jobId || !base64Data) {
      return res.status(400).json({
        ok: false,
        error: 'Missing job_id or file data',
        error_code: 'missing_data'
      });
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    console.log('[portal_upload_artifact] Buffer size:', buffer.length, 'bytes');

    // Upload to Supabase Storage
    const storagePath = `${artifactType}s/${jobId}/${Date.now()}_${filename}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('job-artifacts')
      .upload(storagePath, buffer, {
        contentType: mimetype,
        upsert: true
      });

    if (uploadError) {
      console.error('[portal_upload_artifact] Upload error:', uploadError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to upload file: ' + uploadError.message,
        error_code: 'upload_error'
      });
    }

    console.log('[portal_upload_artifact] Upload successful:', storagePath);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('job-artifacts')
      .getPublicUrl(storagePath);

    const publicUrl = urlData.publicUrl;

    console.log('[portal_upload_artifact] Public URL:', publicUrl);

    // Store in artifacts table - use actual schema: type, file_url, photo_url, url
    const artifactRecord = {
      job_id: jobId,
      type: artifactType,
      file_url: publicUrl,
      photo_url: publicUrl,
      url: publicUrl,
      pro_id: proId
    };

    const { data: insertedArtifact, error: artifactError } = await supabase
      .from('h2s_dispatch_job_artifacts')
      .insert(artifactRecord)
      .select()
      .single();

    if (artifactError) {
      console.error('[portal_upload_artifact] Artifact insert error:', artifactError);
      console.error('[portal_upload_artifact] Attempted insert:', JSON.stringify(artifactRecord, null, 2));
      return res.status(500).json({
        ok: false,
        error: 'Failed to save artifact to database: ' + artifactError.message,
        error_code: 'db_error',
        details: artifactError
      });
    }

    console.log('[portal_upload_artifact] Artifact saved with ID:', insertedArtifact?.artifact_id);

    // Update job record - increment photo count if it's a photo
    if (artifactType === 'photo') {
      // Get current photo count
      const { data: jobData } = await supabase
        .from('h2s_dispatch_jobs')
        .select('photo_count')
        .eq('job_id', jobId)
        .single();

      const currentCount = parseInt(jobData?.photo_count || 0);

      const { error: updateError } = await supabase
        .from('h2s_dispatch_jobs')
        .update({ 
          photo_count: currentCount + 1,
          photo_on_file: true
        })
        .eq('job_id', jobId);

      if (updateError) {
        console.error('[portal_upload_artifact] Job update error:', updateError);
      }
    }

    console.log('[portal_upload_artifact] ✅ Artifact saved successfully');

    return res.json({ 
      ok: true,
      url: publicUrl,
      artifact_id: insertedArtifact?.artifact_id
    });

  } catch (error) {
    console.error('[portal_upload_artifact] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
