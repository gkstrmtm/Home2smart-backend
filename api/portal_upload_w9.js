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

// Allowed origins for CORS
function getAllowedOrigin(origin) {
  if (!origin) return null;
  
  const allowedOrigins = [
    'https://h2s-backend.vercel.app',
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://127.0.0.1:3002',
    'http://localhost:3002',
    'http://localhost:3000'
  ];
  
  // GHL domains (wildcard matching)
  if (origin.includes('.leadconnectorhq.com') || origin.includes('.msgsndr.com')) {
    return origin;
  }
  
  // Exact match for allowed origins
  if (allowedOrigins.includes(origin)) {
    return origin;
  }
  
  return null;
}

export default async function handler(req, res) {
  // Set CORS headers - match working pattern from portal_upload_photo.js
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  
  // Handle preflight OPTIONS request - MUST return 200 with headers
  // Return early before any auth/body parsing
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // For actual POST requests, validate origin is in allowed list
  const allowedOrigin = getAllowedOrigin(req.headers.origin);
  if (req.method === 'POST' && req.headers.origin && !allowedOrigin) {
    return res.status(403).json({
      ok: false,
      error: 'Origin not allowed',
      error_code: 'cors_error'
    });
  }
  
  // Health check for GET
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, endpoint: 'portal_upload_w9' });
  }

  // Only POST allowed beyond this point
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    console.log('[portal_upload_w9] Request received');
    
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const fileData = body?.file; // Base64 encoded file
    const filename = body?.filename || `w9_${Date.now()}.pdf`;
    const mimetype = body?.mimetype || 'application/pdf';
    
    console.log('[portal_upload_w9] Filename:', filename, 'MIME:', mimetype);

    // Validate session
    const proId = await validateSession(token);
    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    if (!fileData) {
      return res.status(400).json({
        ok: false,
        error: 'Missing file data',
        error_code: 'missing_data'
      });
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(mimetype)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid file type. Only PDF, JPG, and PNG are allowed.',
        error_code: 'invalid_file_type'
      });
    }

    // Extract base64 data
    let base64Data = fileData;
    if (fileData.includes('base64,')) {
      base64Data = fileData.split('base64,')[1];
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    console.log('[portal_upload_w9] Buffer size:', buffer.length, 'bytes');

    // Validate file size (max 10MB)
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({
        ok: false,
        error: 'File too large. Maximum size is 10MB',
        error_code: 'file_too_large'
      });
    }

    // Upload to Supabase Storage (w9-forms bucket - PRIVATE)
    const storagePath = `${proId}/${Date.now()}_${filename}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('w9-forms')
      .upload(storagePath, buffer, {
        contentType: mimetype,
        upsert: true,
        cacheControl: '3600'
      });

    if (uploadError) {
      console.error('[portal_upload_w9] Upload error:', uploadError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to upload file: ' + uploadError.message,
        error_code: 'upload_error'
      });
    }

    console.log('[portal_upload_w9] Upload successful:', storagePath);

    // Generate signed URL (temporary, 1 hour expiry for admin access)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(storagePath, 3600); // 1 hour

    if (signedUrlError) {
      console.error('[portal_upload_w9] Signed URL error:', signedUrlError);
      // Continue anyway - file is uploaded, admin can generate URL when needed
    }

    const fileUrl = signedUrlData?.signedUrl || storagePath; // Fallback to path if signed URL fails

    // Update pro record
    const { data: updatedPro, error: updateError } = await supabase
      .from('h2s_pros')
      .update({
        w9_file_url: fileUrl,
        w9_uploaded_at: new Date().toISOString(),
        w9_status: 'uploaded',
        updated_at: new Date().toISOString()
      })
      .eq('pro_id', proId)
      .select('w9_file_url, w9_uploaded_at, w9_status')
      .single();

    if (updateError) {
      console.error('[portal_upload_w9] Update error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to update pro record: ' + updateError.message,
        error_code: 'db_error'
      });
    }

    console.log('[portal_upload_w9] ✅ W-9 uploaded successfully');

    return res.json({ 
      ok: true,
      w9_file_url: fileUrl,
      w9_uploaded_at: updatedPro.w9_uploaded_at,
      w9_status: updatedPro.w9_status
    });

  } catch (error) {
    console.error('[portal_upload_w9] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}

