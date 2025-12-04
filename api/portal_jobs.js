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
    console.log('[portal_jobs] Request received:', { method: req.method, hasBody: !!req.body });
    
    // Parse body if needed
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    console.log('[portal_jobs] Token present:', !!token);

    if (!token) {
      return res.status(400).json({
        ok: false,
        error: 'Missing token',
        error_code: 'no_token'
      });
    }

    // Validate session
    console.log('[portal_jobs] Validating session...');
    const { data: sessions, error: sessionError } = await supabase
      .from('h2s_sessions')
      .select('pro_id, expires_at')
      .eq('session_id', token)
      .single();
    
    console.log('[portal_jobs] Session query result:', { 
      hasData: !!sessions, 
      hasError: !!sessionError,
      errorMsg: sessionError?.message 
    });

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
      .catch(err => console.error('[portal_jobs] Failed to update last_seen:', err));

    // Get tech's profile (need location and service radius)
    console.log('[portal_jobs] Fetching tech profile for pro_id:', sessions.pro_id);
    const { data: techProfile, error: profileError } = await supabase
      .from('h2s_pros')
      .select('geo_lat, geo_lng, service_radius_miles')
      .eq('pro_id', sessions.pro_id)
      .single();
    
    if (profileError || !techProfile) {
      console.error('[portal_jobs] Failed to get tech profile:', profileError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to load tech profile',
        error_code: 'profile_error'
      });
    }

    const techLat = parseFloat(techProfile.geo_lat);
    const techLng = parseFloat(techProfile.geo_lng);
    const serviceRadius = parseFloat(techProfile.service_radius_miles) || 50; // Default 50 miles

    console.log('[portal_jobs] Tech location:', { lat: techLat, lng: techLng, radius: serviceRadius });

    // Get ALL available jobs within radius (pending_assign or pending status)
    console.log('[portal_jobs] Fetching available jobs with status pending_assign or pending');
    const { data: availableJobs, error: availableError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .in('status', ['pending_assign', 'pending'])
      .not('geo_lat', 'is', null)
      .not('geo_lng', 'is', null);
    
    if (availableError) {
      console.error('[portal_jobs] Failed to fetch available jobs:', availableError);
    }

    console.log('[portal_jobs] Found', availableJobs?.length || 0, 'available jobs total');
    
    // Log each job's coordinates for debugging
    (availableJobs || []).forEach(job => {
      console.log('[portal_jobs] Job:', job.job_id, 'at', job.geo_lat, ',', job.geo_lng, 'customer:', job.customer_name);
    });

    // Filter jobs within service radius
    const jobsWithinRadius = (availableJobs || []).filter(job => {
      const jobLat = parseFloat(job.geo_lat);
      const jobLng = parseFloat(job.geo_lng);
      
      if (isNaN(jobLat) || isNaN(jobLng) || isNaN(techLat) || isNaN(techLng)) {
        return false;
      }

      const distance = calculateDistance(techLat, techLng, jobLat, jobLng);
      console.log('[portal_jobs] Job', job.job_id, 'distance:', distance, 'miles (radius:', serviceRadius, ')');
      return distance <= serviceRadius;
    }).map(job => {
      const jobLat = parseFloat(job.geo_lat);
      const jobLng = parseFloat(job.geo_lng);
      const distance = calculateDistance(techLat, techLng, jobLat, jobLng);
      return {
        ...job,
        distance_miles: Math.round(distance * 10) / 10,
        payout_estimated: job.metadata?.estimated_payout || 0,
        referral_code: job.metadata?.referral_code || null
      };
    });

    console.log('[portal_jobs] Jobs within radius:', jobsWithinRadius.length);

    // Get job assignments for this pro, then fetch job details
    console.log('[portal_jobs] Fetching job assignments for pro_id:', sessions.pro_id);
    const { data: assignments, error: assignError } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('job_id, state, distance_miles, offer_sent_at, accepted_at, declined_at')
      .eq('pro_id', sessions.pro_id)
      .order('offer_sent_at', { ascending: false });
    
    console.log('[portal_jobs] Assignments query result:', { 
      assignmentCount: assignments?.length || 0, 
      hasError: !!assignError,
      errorMsg: assignError?.message 
    });

    if (assignError) {
      console.error('[portal_jobs] Assignment fetch failed:', assignError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch job assignments',
        error_code: 'db_error',
        details: assignError.message
      });
    }

    // If no assignments, still return available jobs within radius
    if (!assignments || assignments.length === 0) {
      console.log('[portal_jobs] No assignments found, but returning', jobsWithinRadius.length, 'jobs within radius');
      return res.json({
        ok: true,
        offers: jobsWithinRadius,
        upcoming: [],
        completed: []
      });
    }

    // Get full job details for assigned jobs
    const jobIds = assignments.map(a => a.job_id);
    console.log('[portal_jobs] Fetching details for', jobIds.length, 'jobs');
    
    const { data: jobs, error: jobsError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .in('job_id', jobIds)
      .order('created_at', { ascending: false });
    
    console.log('[portal_jobs] Jobs query result:', { 
      jobCount: jobs?.length || 0, 
      hasError: !!jobsError,
      errorMsg: jobsError?.message 
    });

    if (jobsError) {
      console.error('[portal_jobs] Job fetch failed:', jobsError);
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

    // Categorize jobs based on assignment state
    // SMART: Merge assignment data into existing offers to preserve distance_miles from assignments
    const offersMap = new Map();
    
    // First, add all available jobs in radius
    jobsWithinRadius.forEach(job => {
      offersMap.set(job.job_id, job);
    });
    
    const upcoming = [];
    const completed = [];

    (jobs || []).forEach(job => {
      const assignment = assignmentMap[job.job_id];
      const state = assignment?.state || '';
      
      // INTELLIGENT: Calculate distance from assignment OR pro location OR job metadata
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
      // Priority 3: Try metadata (if backend stored it)
      else if (job.metadata?.geo_lat && job.metadata?.geo_lng && !isNaN(techLat) && !isNaN(techLng)) {
        const jobLat = parseFloat(job.metadata.geo_lat);
        const jobLng = parseFloat(job.metadata.geo_lng);
        if (!isNaN(jobLat) && !isNaN(jobLng)) {
          finalDistance = calculateDistance(techLat, techLng, jobLat, jobLng);
        }
      }
      
      // Add assignment metadata to job
      const jobWithAssignment = {
        ...job,
        distance_miles: finalDistance != null ? Math.round(finalDistance * 10) / 10 : null,
        is_primary: assignment?.is_primary,
        responded_at: assignment?.responded_at,
        // Expose payout info
        payout_estimated: job.metadata?.estimated_payout || 0,
        referral_code: job.metadata?.referral_code || null
      };
      
      if (state === 'offered') {
        // Update the existing entry with assignment data (preserves distance from assignment)
        offersMap.set(job.job_id, jobWithAssignment);
      } else if (state === 'accepted') {
        upcoming.push(jobWithAssignment);
      } else if (state === 'completed' || state === 'paid') {
        completed.push(jobWithAssignment);
      }
    });
    
    const offers = Array.from(offersMap.values());
    
    console.log('[portal_jobs] Categorized jobs:', { 
      offersCount: offers.length, 
      upcomingCount: upcoming.length, 
      completedCount: completed.length 
    });

    return res.json({
      ok: true,
      offers,
      upcoming,
      completed
    });

  } catch (error) {
    console.error('Error in portal_jobs:', error);
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
