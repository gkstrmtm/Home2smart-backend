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
    console.log('[portal_update_profile] Request received');
    
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const vehicleText = body?.vehicle_text;
    const serviceRadiusMiles = body?.service_radius_miles;
    const maxJobsPerDay = body?.max_jobs_per_day;
    const photoUrl = body?.photo_url;
    const bioShort = body?.bio_short;
    
    console.log('[portal_update_profile] Updating profile fields');

    // Validate session
    const proId = await validateSession(token);
    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    // Build update object (only include fields that are provided)
    const updates = {};
    
    if (vehicleText !== undefined) {
      updates.vehicle_text = vehicleText.trim();
    }
    
    if (serviceRadiusMiles !== undefined && serviceRadiusMiles !== '') {
      const radius = parseFloat(serviceRadiusMiles);
      if (!isNaN(radius) && radius >= 0) {
        updates.service_radius_miles = radius;
      }
    }
    
    if (maxJobsPerDay !== undefined && maxJobsPerDay !== '') {
      const maxJobs = parseInt(maxJobsPerDay, 10);
      if (!isNaN(maxJobs) && maxJobs >= 0) {
        updates.max_jobs_per_day = maxJobs;
      }
    }
    
    if (photoUrl !== undefined) {
      updates.photo_url = photoUrl.trim();
    }
    
    if (bioShort !== undefined) {
      updates.bio_short = bioShort.trim();
    }

    // Add updated timestamp
    updates.updated_at = new Date().toISOString();

    console.log('[portal_update_profile] Updates:', Object.keys(updates));

    // Update the pro record - FIXED: Use h2s_pros for consistency
    const { data, error } = await supabase
      .from('h2s_pros')
      .update(updates)
      .eq('pro_id', proId)
      .select()
      .single();

    if (error) {
      console.error('[portal_update_profile] Update error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to update profile: ' + error.message,
        error_code: 'update_error'
      });
    }

    console.log('[portal_update_profile] ✅ Profile updated successfully');

    return res.json({ 
      ok: true,
      pro: data
    });

  } catch (error) {
    console.error('[portal_update_profile] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
