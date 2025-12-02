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
      announcement_id,
      title, 
      message, 
      type, 
      priority, 
      video_url, 
      expires_at, 
      is_active
    } = body || {};

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

    // Build update object (only include provided fields)
    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (title !== undefined) updateData.title = title.trim();
    if (message !== undefined) updateData.message = message.trim();
    if (type !== undefined) updateData.type = type;
    if (priority !== undefined) updateData.priority = priority;
    if (video_url !== undefined) updateData.video_url = video_url || null;
    if (expires_at !== undefined) updateData.expires_at = expires_at || null;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data: announcement, error: updateError } = await supabase
      .from('h2s_announcements')
      .update(updateData)
      .eq('announcement_id', announcement_id)
      .select()
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to update announcement: ' + updateError.message,
        error_code: 'update_error'
      });
    }

    if (!announcement) {
      return res.status(404).json({
        ok: false,
        error: 'Announcement not found',
        error_code: 'not_found'
      });
    }

    console.log('✅ Announcement updated:', announcement_id);

    return res.json({
      ok: true,
      announcement: announcement
    });

  } catch (error) {
    console.error('Update announcement error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
