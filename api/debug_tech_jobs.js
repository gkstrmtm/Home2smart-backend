/**
 * DEBUG: Show what portal_jobs would return for a specific tech
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    const techEmail = req.query.email || 'test@example.com';
    
    // Get tech
    const { data: tech, error: techError } = await supabase
      .from('h2s_pros')
      .select('*')
      .eq('email', techEmail)
      .single();
    
    if (techError || !tech) {
      return res.json({ error: 'Tech not found', email: techEmail });
    }

    const techLat = parseFloat(tech.geo_lat);
    const techLng = parseFloat(tech.geo_lng);
    const serviceRadius = parseFloat(tech.service_radius_miles) || 50;

    // Get all pending jobs
    const { data: jobs, error: jobsError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .eq('status', 'pending_assign');

    const results = (jobs || []).map(job => {
      const jobLat = parseFloat(job.geo_lat);
      const jobLng = parseFloat(job.geo_lng);
      const distance = calculateDistance(techLat, techLng, jobLat, jobLng);
      const withinRadius = distance <= serviceRadius;

      return {
        job_id: job.job_id,
        customer: job.customer_name,
        address: `${job.service_address}, ${job.service_city}, ${job.service_state}`,
        job_coords: { lat: jobLat, lng: jobLng },
        distance_miles: Math.round(distance * 10) / 10,
        within_radius: withinRadius,
        status: job.status
      };
    });

    return res.json({
      tech: {
        email: tech.email,
        name: tech.name,
        coords: { lat: techLat, lng: techLng },
        service_radius_miles: serviceRadius
      },
      total_pending_jobs: jobs?.length || 0,
      jobs_within_radius: results.filter(j => j.within_radius).length,
      all_jobs: results
    });

  } catch (error) {
    return res.json({ error: error.message });
  }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959;
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
