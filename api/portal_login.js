import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  console.log('=== LOGIN REQUEST ===');
  console.log('Method:', req.method);
  console.log('Origin:', req.headers.origin);
  console.log('Body:', req.body);
  
  // CORS - Allow all origins
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    console.log('OPTIONS request - sending 200');
    return res.status(200).end();
  }

  try {
    console.log('Environment check:', {
      hasUrl: !!process.env.SUPABASE_URL,
      hasKey: !!process.env.SUPABASE_ANON_KEY,
      url: process.env.SUPABASE_URL
    });
    
    // Parse body if needed
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const { email, zip } = body || {};

    if (!email || !zip) {
      console.log('Missing fields');
      return res.status(400).json({
        ok: false,
        error: 'Missing email or zip',
        error_code: 'missing_fields'
      });
    }

    console.log('Querying Supabase for:', { email, zip });
    
    // Query pro
    const { data: pros, error: proError } = await supabase
      .from('h2s_pros')
      .select('*')
      .eq('email', email.trim().toLowerCase())
      .eq('home_zip', zip.trim());

    console.log('Supabase response:', { 
      foundPros: pros?.length || 0, 
      error: proError?.message || null 
    });

    if (proError || !pros || pros.length === 0) {
      console.log('No account found');
      return res.status(404).json({
        ok: false,
        error: 'No account found. Try sign up.',
        error_code: 'not_found'
      });
    }

    const pro = pros[0];
    console.log('Found pro:', pro.pro_id);

    // Create session
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    console.log('Creating session:', sessionId);

    const { error: sessionError } = await supabase
      .from('h2s_sessions')
      .insert({
        session_id: sessionId,
        pro_id: pro.pro_id,
        expires_at: expiresAt.toISOString(),
        last_seen_at: new Date().toISOString()
      });

    if (sessionError) {
      console.error('Session creation failed:', sessionError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create session',
        error_code: 'session_error'
      });
    }

    console.log('Login successful!');
    
    return res.json({
      ok: true,
      token: sessionId,
      pro: {
        pro_id: pro.pro_id,
        name: pro.name || '',
        email: pro.email || '',
        phone: pro.phone || '',
        home_address: pro.home_address || '',
        home_city: pro.home_city || '',
        home_state: pro.home_state || '',
        home_zip: pro.home_zip || '',
        geo_lat: pro.geo_lat || '',
        geo_lng: pro.geo_lng || '',
        vehicle_text: pro.vehicle_text || '',
        service_radius_miles: Number(pro.service_radius_miles || 0),
        max_jobs_per_day: Number(pro.max_jobs_per_day || 0),
        photo_url: pro.photo_url || '',
        bio_short: pro.bio_short || '',
        status: pro.status || 'pending',
        slug: pro.slug || ''
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
