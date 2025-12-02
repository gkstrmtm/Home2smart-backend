import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: { bodyParser: true },
};

/**
 * Validate admin session
 */
async function validateAdminSession(token) {
  if (!token) return null;
  
  const { data, error } = await supabase
    .from('h2s_admin_sessions')
    .select('email')
    .eq('session_id', token)
    .single();

  if (error || !data) return null;
  return data.email;
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
    
    const { announcement_id } = body || {};

    // Validate admin
    const adminToken = body?.admin_token || body?.token;
    const adminEmail = await validateAdminSession(adminToken);
    
    if (!adminEmail) {
      return res.status(401).json({
        ok: false,
        error: 'Admin access required',
        error_code: 'unauthorized'
      });
    }

    if (!announcement_id) {
      return res.status(400).json({
        ok: false,
        error: 'Missing announcement_id',
        error_code: 'missing_id'
      });
    }

    // Delete announcement (CASCADE will delete related views)
    const { error: deleteError } = await supabase
      .from('h2s_announcements')
      .delete()
      .eq('announcement_id', announcement_id);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to delete announcement: ' + deleteError.message,
        error_code: 'delete_error'
      });
    }

    console.log('✅ Announcement deleted:', announcement_id);

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error('Delete announcement error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
