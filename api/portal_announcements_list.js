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
    const userEmail = body?.user_email || req.query?.user_email;
    const isAdmin = body?.admin === 'true' || req.query?.admin === 'true';

    let proId = null;
    
    // Get pro_id if token provided
    if (token && !isAdmin) {
      proId = await validateSession(token);
    }

    // Build query for active announcements
    let query = supabase
      .from('h2s_announcements')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    // Filter by expiration
    query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    const { data: announcements, error: announcementsError } = await query;

    if (announcementsError) {
      console.error('Announcements query error:', announcementsError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to load announcements',
        error_code: 'query_error'
      });
    }

    // Get viewed announcement IDs for this pro
    let viewedIds = [];
    if (proId) {
      const { data: views, error: viewsError } = await supabase
        .from('h2s_announcement_views')
        .select('announcement_id')
        .eq('pro_id', proId);

      if (!viewsError && views) {
        viewedIds = views.map(v => v.announcement_id);
      }
    }

    console.log(`✅ Loaded ${announcements?.length || 0} announcements`);
    if (proId) {
      console.log(`   Pro ${proId} has viewed ${viewedIds.length} announcements`);
    }

    return res.json({
      ok: true,
      announcements: announcements || [],
      viewed_ids: viewedIds
    });

  } catch (error) {
    console.error('List announcements error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
