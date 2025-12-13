import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function validateAdmin(token) {
  // Simple admin token check - enhance if you have a more robust admin system
  // For now, check against ADMIN_TOKEN env var or implement your admin validation
  if (!token) return false;
  
  // Check if token matches admin token pattern
  // You can enhance this with actual admin session validation
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && token === adminToken) {
    return true;
  }
  
  // Add additional admin validation logic here if needed
  return false;
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
    const proId = body?.pro_id || req.query?.pro_id;

    // Validate admin
    const isAdmin = await validateAdmin(token);
    if (!isAdmin) {
      return res.status(403).json({
        ok: false,
        error: 'Admin access required',
        error_code: 'unauthorized'
      });
    }

    if (!proId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing pro_id',
        error_code: 'missing_data'
      });
    }

    // Get pro record
    const { data: pro, error: proError } = await supabase
      .from('h2s_pros')
      .select('pro_id, name, w9_file_url, w9_uploaded_at, w9_status')
      .eq('pro_id', proId)
      .single();

    if (proError || !pro) {
      return res.status(404).json({
        ok: false,
        error: 'Pro not found',
        error_code: 'not_found'
      });
    }

    if (!pro.w9_file_url) {
      return res.status(404).json({
        ok: false,
        error: 'W-9 not uploaded',
        error_code: 'no_w9'
      });
    }

    // Extract storage path from URL or use directly
    let storagePath = pro.w9_file_url;
    if (storagePath.includes('/storage/v1/object/public/')) {
      // Extract path from public URL
      storagePath = storagePath.split('/w9-forms/')[1];
    } else if (storagePath.includes('/w9-forms/')) {
      storagePath = storagePath.split('/w9-forms/')[1];
    } else if (!storagePath.includes('/')) {
      // Assume it's just the filename, prepend pro_id
      storagePath = `${proId}/${storagePath}`;
    }

    // Generate signed URL (1 hour expiry)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('w9-forms')
      .createSignedUrl(storagePath, 3600);

    if (signedUrlError) {
      console.error('[admin_get_w9] Signed URL error:', signedUrlError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to generate access URL: ' + signedUrlError.message,
        error_code: 'url_error'
      });
    }

    return res.json({
      ok: true,
      download_url: signedUrlData.signedUrl,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      pro_name: pro.name,
      w9_status: pro.w9_status,
      w9_uploaded_at: pro.w9_uploaded_at
    });

  } catch (error) {
    console.error('[admin_get_w9] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}

