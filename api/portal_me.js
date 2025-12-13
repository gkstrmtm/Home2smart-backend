import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS - Allow all origins
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Parse body if needed
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    // Get token from body, query, OR Authorization header
    let token = body?.token || req.query?.token;
    
    // Check Authorization header if token not in body/query
    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(400).json({
        ok: false,
        error: 'Missing token',
        error_code: 'no_token'
      });
    }

    // Validate session
    const { data: sessions, error: sessionError } = await supabase
      .from('h2s_sessions')
      .select('pro_id, expires_at')
      .eq('session_id', token)
      .single();

    if (sessionError || !sessions) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    // Check if expired
    const expiresAt = new Date(sessions.expires_at);
    if (new Date() > expiresAt) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    // Update last_seen_at (async, don't wait)
    supabase
      .from('h2s_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('session_id', token)
      .then(() => {});

    // Get pro data
    const { data: pros, error: proError } = await supabase
      .from('h2s_pros')
      .select('*')
      .eq('pro_id', sessions.pro_id)
      .single();

    if (proError || !pros) {
      return res.status(404).json({
        ok: false,
        error: 'Pro not found',
        error_code: 'pro_not_found'
      });
    }

    return res.json({
      ok: true,
      pro: {
        pro_id: pros.pro_id,
        name: pros.name || '',
        email: pros.email || '',
        phone: pros.phone || '',
        home_address: pros.home_address || '',
        home_city: pros.home_city || '',
        home_state: pros.home_state || '',
        home_zip: pros.home_zip || '',
        geo_lat: pros.geo_lat || '',
        geo_lng: pros.geo_lng || '',
        vehicle_text: pros.vehicle_text || '',
        service_radius_miles: Number(pros.service_radius_miles || 0),
        max_jobs_per_day: Number(pros.max_jobs_per_day || 0),
        photo_url: pros.photo_url || '',
        bio_short: pros.bio_short || '',
        status: pros.status || 'pending',
        slug: pros.slug || ''
      }
    });

  } catch (error) {
    console.error('Me error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error',
      error_code: 'server_error'
    });
  }
}
