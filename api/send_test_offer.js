/**
 * Send offer for the Greenwood test job to a specific tech
 * This creates the assignment so the job shows up in portal
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get the tech's pro_id (you'll need to provide this)
    const techEmail = req.query.tech_email || 'tech@greenwood.com';
    
    console.log('[SendTestOffer] Looking for tech:', techEmail);
    
    // Find tech by email
    const { data: tech, error: techError } = await supabase
      .from('h2s_pros')
      .select('pro_id, name, geo_lat, geo_lng, service_radius_miles')
      .eq('email', techEmail)
      .single();
    
    if (techError || !tech) {
      return res.status(404).json({
        ok: false,
        error: `Tech not found with email: ${techEmail}`,
        hint: 'Sign up a tech account first with this email, or provide ?tech_email=your@email.com'
      });
    }

    // Find the latest Greenwood test job
    const { data: job, error: jobError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .eq('customer_name', 'Greenwood Test Customer')
      .eq('status', 'pending_assign')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (jobError || !job) {
      return res.status(404).json({
        ok: false,
        error: 'No pending Greenwood test job found',
        hint: 'Run /api/create_test_job_greenwood first'
      });
    }

    console.log('[SendTestOffer] Found job:', job.job_id);
    console.log('[SendTestOffer] Sending to tech:', tech.pro_id, tech.name);

    // Calculate distance (simple Haversine)
    const distance = calculateDistance(
      parseFloat(job.geo_lat),
      parseFloat(job.geo_lng),
      parseFloat(tech.geo_lat),
      parseFloat(tech.geo_lng)
    );

    // Create assignment
    const assignmentData = {
      job_id: job.job_id,
      pro_id: tech.pro_id,
      state: 'offered',
      distance_miles: distance,
      offer_sent_at: new Date().toISOString()
    };

    const { data: assignment, error: assignError } = await supabase
      .from('h2s_dispatch_job_assignments')
      .insert([assignmentData])
      .select();

    if (assignError) {
      console.error('[SendTestOffer] Assignment error:', assignError);
      return res.status(500).json({
        ok: false,
        error: assignError.message
      });
    }

    console.log('[SendTestOffer] ✅ Offer sent!', assignment[0]);

    return res.status(200).json({
      ok: true,
      message: 'Test offer sent!',
      job: {
        job_id: job.job_id,
        customer: job.customer_name,
        address: `${job.service_address}, ${job.service_city}, ${job.service_state}`
      },
      tech: {
        pro_id: tech.pro_id,
        name: tech.name,
        email: techEmail
      },
      distance_miles: Math.round(distance * 10) / 10,
      next_step: `Login to portal as ${techEmail} to see the job offer`
    });

  } catch (error) {
    console.error('[SendTestOffer] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
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
