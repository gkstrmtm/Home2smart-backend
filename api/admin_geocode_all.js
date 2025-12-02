import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * Geocode address using Google Maps API
 */
async function geocodeAddress(address, city, state, zip) {
  if (!address || !city || !state) {
    return { lat: null, lng: null, geocoded: false, error: 'Insufficient address' };
  }

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return { lat: null, lng: null, geocoded: false, error: 'No API key' };
  }

  const fullAddress = `${address}, ${city}, ${state} ${zip || ''}`.trim();

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.results?.length > 0) {
      const location = data.results[0].geometry.location;
      return { 
        lat: parseFloat(location.lat), 
        lng: parseFloat(location.lng), 
        geocoded: true,
        formatted_address: data.results[0].formatted_address
      };
    } else {
      return { lat: null, lng: null, geocoded: false, error: data.status };
    }
  } catch (error) {
    return { lat: null, lng: null, geocoded: false, error: error.message };
  }
}

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
 * Bulk geocode all jobs and techs with missing coordinates
 */
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
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    const { token, target = 'both' } = body; // target: 'jobs', 'pros', or 'both'

    // Validate admin session
    const isValid = await validateAdminSession(token);
    if (!isValid) {
      return res.status(401).json({
        ok: false,
        error: 'Not authorized',
        error_code: 'invalid_session'
      });
    }

    const results = {
      jobs: { total: 0, geocoded: 0, failed: 0, skipped: 0, details: [] },
      pros: { total: 0, geocoded: 0, failed: 0, skipped: 0, details: [] }
    };

    // GEOCODE JOBS
    if (target === 'jobs' || target === 'both') {
      console.log('[geocode_all] Processing jobs...');
      
      const { data: jobs, error: jobsError } = await supabase
        .from('h2s_dispatch_jobs')
        .select('job_id, service_address, service_city, service_state, service_zip, geo_lat, geo_lng')
        .or('geo_lat.is.null,geo_lng.is.null');

      if (jobsError) {
        console.error('[geocode_all] Jobs query error:', jobsError);
      } else {
        results.jobs.total = jobs.length;
        console.log('[geocode_all] Found', jobs.length, 'jobs without coordinates');

        for (const job of jobs) {
          // Skip if no address
          if (!job.service_address || !job.service_city || !job.service_state) {
            results.jobs.skipped++;
            results.jobs.details.push({
              id: job.job_id,
              status: 'skipped',
              reason: 'No address data'
            });
            continue;
          }

          // Geocode
          const { lat, lng, geocoded, formatted_address, error } = await geocodeAddress(
            job.service_address,
            job.service_city,
            job.service_state,
            job.service_zip
          );

          if (geocoded) {
            // Update job with coordinates
            const { error: updateError } = await supabase
              .from('h2s_dispatch_jobs')
              .update({
                geo_lat: lat,
                geo_lng: lng,
                updated_at: new Date().toISOString()
              })
              .eq('job_id', job.job_id);

            if (updateError) {
              results.jobs.failed++;
              results.jobs.details.push({
                id: job.job_id,
                status: 'failed',
                reason: 'Update failed: ' + updateError.message
              });
            } else {
              results.jobs.geocoded++;
              results.jobs.details.push({
                id: job.job_id,
                status: 'geocoded',
                address: formatted_address,
                coordinates: `${lat}, ${lng}`
              });
            }
          } else {
            results.jobs.failed++;
            results.jobs.details.push({
              id: job.job_id,
              status: 'failed',
              reason: error || 'Geocoding failed'
            });
          }

          // Rate limit: Google allows 50 requests/sec, we'll do 10/sec to be safe
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    // GEOCODE PROS
    if (target === 'pros' || target === 'both') {
      console.log('[geocode_all] Processing pros...');
      
      const { data: pros, error: prosError } = await supabase
        .from('h2s_pros')
        .select('pro_id, name, home_address, home_city, home_state, home_zip, geo_lat, geo_lng')
        .or('geo_lat.is.null,geo_lng.is.null');

      if (prosError) {
        console.error('[geocode_all] Pros query error:', prosError);
      } else {
        results.pros.total = pros.length;
        console.log('[geocode_all] Found', pros.length, 'pros without coordinates');

        for (const pro of pros) {
          // Skip if no address
          if (!pro.home_address || !pro.home_city || !pro.home_state) {
            results.pros.skipped++;
            results.pros.details.push({
              id: pro.pro_id,
              name: pro.name,
              status: 'skipped',
              reason: 'No address data'
            });
            continue;
          }

          // Geocode
          const { lat, lng, geocoded, formatted_address, error } = await geocodeAddress(
            pro.home_address,
            pro.home_city,
            pro.home_state,
            pro.home_zip
          );

          if (geocoded) {
            // Update pro with coordinates
            const { error: updateError } = await supabase
              .from('h2s_pros')
              .update({
                geo_lat: lat,
                geo_lng: lng,
                updated_at: new Date().toISOString()
              })
              .eq('pro_id', pro.pro_id);

            if (updateError) {
              results.pros.failed++;
              results.pros.details.push({
                id: pro.pro_id,
                name: pro.name,
                status: 'failed',
                reason: 'Update failed: ' + updateError.message
              });
            } else {
              results.pros.geocoded++;
              results.pros.details.push({
                id: pro.pro_id,
                name: pro.name,
                status: 'geocoded',
                address: formatted_address,
                coordinates: `${lat}, ${lng}`
              });
            }
          } else {
            results.pros.failed++;
            results.pros.details.push({
              id: pro.pro_id,
              name: pro.name,
              status: 'failed',
              reason: error || 'Geocoding failed'
            });
          }

          // Rate limit
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }

    console.log('[geocode_all] Complete:', results);

    return res.status(200).json({
      ok: true,
      results
    });

  } catch (error) {
    console.error('[geocode_all] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      error_code: 'internal_error',
      details: error.message
    });
  }
}
