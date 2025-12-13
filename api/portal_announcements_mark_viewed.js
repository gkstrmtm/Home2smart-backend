import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: { bodyParser: true },
};

/**
 * Validate session and get pro_id
 */
async function validateSession(token) {
  if (!token) return null;
  
  const { data, error } = await supabase
    .from('h2s_sessions')
    .select('pro_id, expires_at')
    .eq('session_id', token)
    .single();

  if (error || !data) return null;
  if (new Date() > new Date(data.expires_at)) return null;

  return data.pro_id;
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
    
    const token = body?.token || req.query?.token;
    const announcementId = body?.announcement_id || req.query?.announcement_id;

    // Validate session
    const proId = await validateSession(token);
    
    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    if (!announcementId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing announcement_id',
        error_code: 'missing_id'
      });
    }

    // Mark as viewed (upsert to avoid duplicates)
    const { error: upsertError } = await supabase
      .from('h2s_announcement_views')
      .upsert({
        announcement_id: announcementId,
        pro_id: proId,
        viewed_at: new Date().toISOString()
      }, {
        onConflict: 'announcement_id,pro_id'
      });

    if (upsertError) {
      console.error('Mark viewed error:', upsertError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to mark as viewed: ' + upsertError.message,
        error_code: 'upsert_error'
      });
    }

    console.log(`✅ Announcement ${announcementId} marked viewed by pro ${proId}`);

    return res.json({
      ok: true
    });

  } catch (error) {
    console.error('Mark viewed error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
