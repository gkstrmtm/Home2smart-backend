/**
 * Create test job directly in h2s_dispatch_jobs for Greenwood, SC
 * This bypasses orders and creates a job ready for techs to see
 */
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

async function geocodeAddress(address, city, state, zip) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('[geocode] No API key');
    return { lat: null, lng: null };
  }

  const fullAddress = `${address}, ${city}, ${state} ${zip}`.trim();
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      console.log(`[geocode] ✅ ${fullAddress} → ${location.lat}, ${location.lng}`);
      return { lat: location.lat, lng: location.lng };
    } else {
      console.warn(`[geocode] Failed: ${data.status}`);
      return { lat: null, lng: null };
    }
  } catch (error) {
    console.error('[geocode] Error:', error);
    return { lat: null, lng: null };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const jobId = `job-greenwood-${Date.now()}`;
    const address = '116 Main Street'; // REAL address in Greenwood, SC
    const city = 'Greenwood';
    const state = 'SC';
    const zip = '29646';

    console.log('[CreateTestJob] Geocoding REAL address...');
    let { lat, lng } = await geocodeAddress(address, city, state, zip);
    
    // Fallback to hardcoded Greenwood, SC coordinates if geocoding fails
    if (!lat || !lng) {
      console.warn('[CreateTestJob] Geocoding failed, using hardcoded Greenwood coordinates');
      lat = 34.1954;
      lng = -82.1618;
    }

    // Create job in dispatch table
    const jobData = {
      job_id: jobId,
      service_id: 'security-cameras',
      notes_from_customer: 'Security Camera Installation (2x) for Test Customer in Greenwood',
      customer_name: 'Greenwood Test Customer',
      customer_email: 'test@greenwood.com',
      service_address: address,
      service_city: city,
      service_state: state,
      service_zip: zip,
      geo_lat: lat ? lat.toString() : null,
      geo_lng: lng ? lng.toString() : null,
      status: 'pending_assign',
      created_at: new Date().toISOString(),
      start_iso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
      resources_needed: 'Security cameras (2x), mounting hardware, cables',
      variant_code: 'standard'
    };

    const { data: insertedJob, error: insertError } = await supabase
      .from('h2s_dispatch_jobs')
      .insert([jobData])
      .select();

    if (insertError) {
      console.error('[CreateTestJob] Insert error:', insertError);
      return res.status(500).json({
        ok: false,
        error: insertError.message,
        details: insertError
      });
    }

    console.log('[CreateTestJob] ✅ Job created:', insertedJob[0]);

    return res.status(200).json({
      ok: true,
      message: 'Test job created in Greenwood, SC 29646',
      job: {
        job_id: jobId,
        customer: 'Greenwood Test Customer',
        address: `${address}, ${city}, ${state} ${zip}`,
        coordinates: lat && lng ? `${lat}, ${lng}` : 'Not geocoded',
        service: 'Security Camera Installation (2x)',
        status: 'pending_assign (available for techs)',
        scheduled: 'Tomorrow'
      },
      instructions: [
        '1. Login to portal as tech: portalv3.html',
        '2. Use email/zip from Greenwood, SC area (29646)',
        '3. Check Dashboard > Available Jobs',
        '4. You should see this job if within service radius'
      ]
    });

  } catch (error) {
    console.error('[CreateTestJob] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
