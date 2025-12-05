import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
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
    console.log('[portal_jobs_v2] Request received:', { method: req.method });
    
    // Parse body if needed
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    // Support both body token and query token (and Authorization header if we wanted to be fancy, but sticking to existing pattern)
    let token = body?.token || req.query?.token;
    
    // Also check Authorization header for Bearer token
    if (!token && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        token = parts[1];
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
      .then(() => {})
      .catch(err => console.error('[portal_jobs_v2] Failed to update last_seen:', err));

    // Get tech's profile (need location and service radius)
    const { data: techProfile, error: profileError } = await supabase
      .from('h2s_pros')
      .select('geo_lat, geo_lng, service_radius_miles')
      .eq('pro_id', sessions.pro_id)
      .single();
    
    if (profileError || !techProfile) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to load tech profile',
        error_code: 'profile_error'
      });
    }

    const techLat = parseFloat(techProfile.geo_lat);
    const techLng = parseFloat(techProfile.geo_lng);
    const serviceRadius = parseFloat(techProfile.service_radius_miles) || 50;

    // Get ALL available jobs within radius (pending_assign or pending status)
    const { data: availableJobs, error: availableError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .in('status', ['pending_assign', 'pending'])
      .not('geo_lat', 'is', null)
      .not('geo_lng', 'is', null);
    
    if (availableError) {
      console.error('[portal_jobs_v2] Failed to fetch available jobs:', availableError);
    }

    // Filter jobs within service radius
    const jobsWithinRadius = (availableJobs || []).filter(job => {
      const jobLat = parseFloat(job.geo_lat);
      const jobLng = parseFloat(job.geo_lng);
      
      if (isNaN(jobLat) || isNaN(jobLng) || isNaN(techLat) || isNaN(techLng)) {
        return false;
      }

      const distance = calculateDistance(techLat, techLng, jobLat, jobLng);
      return distance <= serviceRadius;
    }).map(job => {
      const jobLat = parseFloat(job.geo_lat);
      const jobLng = parseFloat(job.geo_lng);
      const distance = calculateDistance(techLat, techLng, jobLat, jobLng);
      return {
        ...job,
        distance_miles: Math.round(distance * 100) / 100, // FIXED: 2 decimal places
        payout_estimated: job.metadata?.estimated_payout || 0,
        referral_code: job.metadata?.referral_code || null
      };
    });

    // Get job assignments for this pro
    const { data: assignments, error: assignError } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('job_id, state, distance_miles, offer_sent_at, accepted_at, declined_at')
      .eq('pro_id', sessions.pro_id)
      .order('offer_sent_at', { ascending: false });
    
    if (assignError) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch job assignments',
        error_code: 'db_error',
        details: assignError.message
      });
    }

    // If no assignments, return available jobs
    if (!assignments || assignments.length === 0) {
      return res.json({
        ok: true,
        offers: jobsWithinRadius,
        upcoming: [],
        completed: []
      });
    }

    // Get full job details for assigned jobs
    const jobIds = assignments.map(a => a.job_id);
    
    const { data: jobs, error: jobsError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .in('job_id', jobIds)
      .order('created_at', { ascending: false });
    
    if (jobsError) {
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch jobs',
        error_code: 'db_error',
        details: jobsError.message
      });
    }

    // Merge assignment state with job data
    const assignmentMap = {};
    assignments.forEach(a => {
      assignmentMap[a.job_id] = {
        state: a.state,
        distance_miles: a.distance_miles,
        offer_sent_at: a.offer_sent_at,
        accepted_at: a.accepted_at,
        declined_at: a.declined_at
      };
    });

    const offersMap = new Map();
    const upcoming = [];
    const completed = [];
    
    // First, add all available jobs in radius
    jobsWithinRadius.forEach(job => {
      const assignment = assignmentMap[job.job_id];
      
      // INTELLIGENT: Use assignment distance if it exists, otherwise use calculated distance
      let finalDistance = job.distance_miles; // Default to what was calculated
      
      if (assignment?.distance_miles != null) {
        finalDistance = parseFloat(assignment.distance_miles);
      }
      
      offersMap.set(job.job_id, {
        ...job,
        distance_miles: finalDistance != null ? Math.round(finalDistance * 100) / 100 : null, // FIXED: 2 decimal places
        payout_estimated: job.metadata?.estimated_payout || 0,
        referral_code: job.metadata?.referral_code || null
      });
    });

    // Then process assigned jobs
    (jobs || []).forEach(job => {
      const assignment = assignmentMap[job.job_id];
      const state = assignment?.state || '';
      
      let finalDistance = null;
      
      // Priority 1: Use assignment distance (most accurate)
      if (assignment?.distance_miles != null) {
        finalDistance = parseFloat(assignment.distance_miles);
      }
      // Priority 2: Calculate from pro location if available
      else if (!isNaN(techLat) && !isNaN(techLng)) {
        const jobLat = parseFloat(job.geo_lat);
        const jobLng = parseFloat(job.geo_lng);
        if (!isNaN(jobLat) && !isNaN(jobLng)) {
          finalDistance = calculateDistance(techLat, techLng, jobLat, jobLng);
        }
      }
      // Priority 3: Try metadata
      else if (job.metadata?.geo_lat && job.metadata?.geo_lng && !isNaN(techLat) && !isNaN(techLng)) {
        const jobLat = parseFloat(job.metadata.geo_lat);
        const jobLng = parseFloat(job.metadata.geo_lng);
        if (!isNaN(jobLat) && !isNaN(jobLng)) {
          finalDistance = calculateDistance(techLat, techLng, jobLat, jobLng);
        }
      }
      
      const jobWithAssignment = {
        ...job,
        distance_miles: finalDistance != null ? Math.round(finalDistance * 100) / 100 : null, // FIXED: 2 decimal places
        is_primary: assignment?.is_primary,
        responded_at: assignment?.responded_at,
        payout_estimated: job.metadata?.estimated_payout || 0,
        referral_code: job.metadata?.referral_code || null
      };
      
      if (state === 'offered') {
        offersMap.set(job.job_id, jobWithAssignment);
      } else if (state === 'accepted') {
        upcoming.push(jobWithAssignment);
      } else if (state === 'completed' || state === 'paid') {
        completed.push(jobWithAssignment);
      }
    });
    
    const offers = Array.from(offersMap.values());

    return res.json({
      ok: true,
      offers,
      upcoming,
      completed
    });

  } catch (error) {
    console.error('Error in portal_jobs_v2:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error',
      error_code: 'server_error',
      details: error.message
    });
  }
}

// Haversine distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}
