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
    console.log('[portal_upload_photo] Request received');
    
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const imageData = body?.image;
    const filename = body?.filename || `profile_${Date.now()}.jpg`;
    
    console.log('[portal_upload_photo] Filename:', filename);

    // Validate session
    const proId = await validateSession(token);
    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    if (!imageData) {
      return res.status(400).json({
        ok: false,
        error: 'Missing image data',
        error_code: 'missing_data'
      });
    }

    // Extract base64 data (remove data:image/...;base64, prefix if present)
    let base64Data = imageData;
    if (imageData.includes('base64,')) {
      base64Data = imageData.split('base64,')[1];
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    console.log('[portal_upload_photo] Buffer size:', buffer.length, 'bytes');

    // Validate file size (max 5MB)
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({
        ok: false,
        error: 'Image too large. Maximum size is 5MB',
        error_code: 'file_too_large'
      });
    }

    // Determine MIME type from filename or default to jpeg
    let mimetype = 'image/jpeg';
    if (filename.endsWith('.png')) mimetype = 'image/png';
    else if (filename.endsWith('.webp')) mimetype = 'image/webp';
    else if (filename.endsWith('.gif')) mimetype = 'image/gif';

    // Upload to Supabase Storage (profile-photos bucket)
    const storagePath = `${proId}/${Date.now()}_${filename}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(storagePath, buffer, {
        contentType: mimetype,
        upsert: true,
        cacheControl: '3600'
      });

    if (uploadError) {
      console.error('[portal_upload_photo] Upload error:', uploadError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to upload photo: ' + uploadError.message,
        error_code: 'upload_error'
      });
    }

    console.log('[portal_upload_photo] Upload successful:', storagePath);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(storagePath);

    const publicUrl = urlData.publicUrl;

    console.log('[portal_upload_photo] ✅ Photo uploaded successfully');
    console.log('[portal_upload_photo] Public URL:', publicUrl);

    return res.json({ 
      ok: true,
      url: publicUrl
    });

  } catch (error) {
    console.error('[portal_upload_photo] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
