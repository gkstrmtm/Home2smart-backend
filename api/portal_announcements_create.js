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
    
    const { 
      title, 
      message, 
      type = 'info', 
      priority = 'normal', 
      video_url, 
      expires_at, 
      is_active = true,
      created_by 
    } = body || {};

    // Validate admin (require admin token OR created_by field)
    const adminToken = body?.admin_token || body?.token;
    const adminEmail = created_by || await validateAdminSession(adminToken);
    
    if (!adminEmail) {
      return res.status(401).json({
        ok: false,
        error: 'Admin access required',
        error_code: 'unauthorized'
      });
    }

    // Validation
    if (!title || !message) {
      return res.status(400).json({
        ok: false,
        error: 'Title and message are required',
        error_code: 'missing_fields'
      });
    }

    // Create announcement
    const announcementData = {
      title: title.trim(),
      message: message.trim(),
      type,
      priority,
      video_url: video_url || null,
      expires_at: expires_at || null,
      is_active,
      created_by: adminEmail,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: announcement, error: insertError } = await supabase
      .from('h2s_announcements')
      .insert(announcementData)
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create announcement: ' + insertError.message,
        error_code: 'insert_error'
      });
    }

    console.log('✅ Announcement created:', announcement.announcement_id);

    return res.json({
      ok: true,
      announcement: announcement
    });

  } catch (error) {
    console.error('Create announcement error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
