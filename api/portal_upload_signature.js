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
    console.log('[portal_upload_signature] Request received');
    
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const jobId = body?.job_id || req.query?.job_id;
    const base64Data = body?.data;
    const filename = body?.filename || `signature_${jobId}.png`;
    const mimetype = body?.mimetype || 'image/png';
    
    console.log('[portal_upload_signature] Job:', jobId, 'Filename:', filename);

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
        error: 'Missing job_id or signature data',
        error_code: 'missing_data'
      });
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    console.log('[portal_upload_signature] Buffer size:', buffer.length, 'bytes');

    // Upload to Supabase Storage
    const storagePath = `signatures/${jobId}/${filename}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('job-artifacts')
      .upload(storagePath, buffer, {
        contentType: mimetype,
        upsert: true
      });

    if (uploadError) {
      console.error('[portal_upload_signature] Upload error:', uploadError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to upload signature: ' + uploadError.message,
        error_code: 'upload_error'
      });
    }

    console.log('[portal_upload_signature] Upload successful:', storagePath);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('job-artifacts')
      .getPublicUrl(storagePath);

    const publicUrl = urlData.publicUrl;

    // Update job record with signature URL
    const { error: updateError } = await supabase
      .from('h2s_dispatch_jobs')
      .update({ 
        signature_url: publicUrl,
        has_signature: true
      })
      .eq('job_id', jobId);

    if (updateError) {
      console.error('[portal_upload_signature] Job update error:', updateError);
    }

    // Also store in artifacts table
    const { error: artifactError } = await supabase
      .from('h2s_dispatch_job_artifacts')
      .insert({
        job_id: jobId,
        type: 'signature',  // ✅ Fixed: was artifact_type, should be type
        file_url: publicUrl,
        url: publicUrl,
        pro_id: proId
      });

    if (artifactError) {
      console.error('[portal_upload_signature] Artifact insert error:', artifactError);
    }

    console.log('[portal_upload_signature] ✅ Signature saved successfully');

    return res.json({ 
      ok: true,
      url: publicUrl
    });

  } catch (error) {
    console.error('[portal_upload_signature] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
