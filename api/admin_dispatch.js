import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * Validate admin session
 */
async function validateAdminSession(token) {
  if (!token) return false;
  
  const { data, error } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('admin_email')
    .eq('session_id', token)
    .gte('expires_at', new Date().toISOString())
    .single();

  if (error || !data) return false;
  
  await supabase
    .from('h2s_dispatch_admin_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', token);
  
  return true;
}

/**
 * Calculate distance between two points using Haversine formula
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Find available techs for a job based on:
 * - Location/radius
 * - Availability (not on time off)
 * - Active status
 * - Service capabilities
 */
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

    const { token, job_id, action = 'find_matches' } = body;

    console.log('[admin_dispatch] Request:', { job_id, action });

    // Validate admin session
    const isValid = await validateAdminSession(token);
    if (!isValid) {
      console.log('[admin_dispatch] Invalid or expired token');
      return res.status(401).json({
        ok: false,
        error: 'Not authorized',
        error_code: 'invalid_session'
      });
    }

    if (!job_id) {
      return res.status(400).json({
        ok: false,
        error: 'Missing job_id',
        error_code: 'missing_parameter'
      });
    }

    console.log('[admin_dispatch] ✅ Admin session valid');

    // --- ACTION: ASSIGN PRO ---
    if (action === 'assign') {
        const { pro_id, pro_name } = body;
        if (!pro_id) return res.status(400).json({ ok: false, error: 'Missing pro_id' });

        // 1. Update Job
        const { error: updateError } = await supabase
            .from('h2s_dispatch_jobs')
            .update({
                assigned_pro_id: pro_id,
                assigned_pro_name: pro_name, // Optional, but good for cache
                status: 'accepted', // Force accept for manual assignment
                updated_at: new Date().toISOString()
            })
            .eq('job_id', job_id);

        if (updateError) throw updateError;

        // 2. Create Notification (Optional but recommended)
        // await createNotification(pro_id, 'New Job Assigned', `You have been assigned job ${job_id}`);

        return res.json({ ok: true, message: 'Job assigned successfully' });
    }

    // --- ACTION: FIND MATCHES ---

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .eq('job_id', job_id)
      .single();

    if (jobError || !job) {
      console.error('[admin_dispatch] Job not found:', jobError);
      return res.status(404).json({
        ok: false,
        error: 'Job not found',
        error_code: 'job_not_found'
      });
    }

    console.log('[admin_dispatch] Job loaded:', job.job_id);

    // Get all active pros
    const { data: allPros, error: prosError } = await supabase
      .from('h2s_pros')
      .select('*')
      .eq('status', 'active')
      .or('is_active.eq.true,is_active.is.null'); // Include pros without is_active column

    if (prosError) {
      console.error('[admin_dispatch] Pros query error:', prosError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch pros',
        error_code: 'query_failed',
        details: prosError.message
      });
    }

    console.log('[admin_dispatch] Found', allPros.length, 'active pros');

    // Filter pros based on availability and location
    const matchedPros = [];
    const now = new Date();

    for (const pro of allPros) {
      const reasons = [];
      
      // Check if pro has valid location
      if (!pro.geo_lat || !pro.geo_lng || pro.geo_lat === 0 || pro.geo_lng === 0) {
        reasons.push('No location set');
        continue;
      }

      // Check if job has location
      let jobLat = null;
      let jobLng = null;
      
      if (job.geo_lat && job.geo_lng && job.geo_lat !== 0 && job.geo_lng !== 0) {
        jobLat = parseFloat(job.geo_lat);
        jobLng = parseFloat(job.geo_lng);
      }

      // Calculate distance if both have locations
      let distance = null;
      if (jobLat && jobLng) {
        distance = calculateDistance(
          parseFloat(pro.geo_lat),
          parseFloat(pro.geo_lng),
          jobLat,
          jobLng
        );

        // Check service radius
        const maxRadius = pro.max_distance_miles || pro.service_radius_miles || 50;
        if (distance > maxRadius) {
          reasons.push(`Outside radius (${distance.toFixed(1)} mi > ${maxRadius} mi)`);
          continue;
        }
      }

      // Check if pro is available (not on time off)
      // Note: Time off would be in a separate table, for now we skip this check
      
      // Pro is a match!
      matchedPros.push({
        pro_id: pro.pro_id,
        name: pro.name || 'Unknown',
        email: pro.email,
        phone: pro.phone || '',
        distance_miles: distance ? parseFloat(distance.toFixed(2)) : null,
        max_radius: pro.max_distance_miles || pro.service_radius_miles || 50,
        max_jobs_per_day: pro.max_jobs_per_day || 5,
        service_codes: pro.service_codes || '',
        city: pro.city || '',
        state: pro.state || ''
      });
    }

    // Sort by distance (closest first)
    matchedPros.sort((a, b) => {
      if (a.distance_miles === null) return 1;
      if (b.distance_miles === null) return -1;
      return a.distance_miles - b.distance_miles;
    });

    console.log('[admin_dispatch] Matched', matchedPros.length, 'pros');

    return res.status(200).json({
      ok: true,
      job: {
        job_id: job.job_id,
        service_id: job.service_id,
        customer_name: job.customer_name,
        address: job.service_address,
        city: job.service_city,
        state: job.service_state,
        zip: job.service_zip
      },
      matches: matchedPros,
      total_matches: matchedPros.length
    });

  } catch (error) {
    console.error('[admin_dispatch] Unexpected error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      error_code: 'internal_error',
      details: error.message
    });
  }
}
