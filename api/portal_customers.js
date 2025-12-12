import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/portal_customers
 * Returns customers for pro to call (appointments, quotes, leads)
 * 
 * Requires: Bearer token (pro_id from portal session)
 */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Get token from query, body, OR Authorization header
    let token = req.query?.token || req.body?.token;
    
    // Check Authorization header if token not in query/body
    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(401).json({ ok: false, error: 'Missing auth token' });
    }
    
    // Validate session and get pro_id
    const { data: session, error: sessionError } = await supabase
      .from('h2s_sessions')
      .select('pro_id')
      .eq('session_id', token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (sessionError || !session) {
      console.error('[portal_customers] Invalid session:', sessionError);
      return res.status(401).json({ ok: false, error: 'Invalid or expired session' });
    }

    const pro_id = session.pro_id;
    console.log(`[portal_customers] Fetching customers for pro: ${pro_id}`);

    // --- DEBUG PROBE START ---
    // Fetch all assignments for this pro to debug why they might not be showing up
    const { data: debugAssignments } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('*')
      .eq('pro_id', pro_id);

    let debugJobs = [];
    if (debugAssignments && debugAssignments.length > 0) {
        const jobIds = debugAssignments.map(a => a.job_id);
        const { data: jobs } = await supabase
            .from('h2s_dispatch_jobs')
            .select('job_id, status, start_iso, customer_name')
            .in('job_id', jobIds);
        debugJobs = jobs || [];
    }
    // --- DEBUG PROBE END ---

    // Query upcoming appointments assigned to this pro
    const { data: rawAssignments, error: apptError } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select(`
        job_id,
        h2s_dispatch_jobs!inner (
          job_id,
          customer_name,
          customer_phone,
          customer_email,
          start_iso,
          end_iso,
          status,
          order_id
        )
      `)
      .eq('pro_id', pro_id)
      .eq('state', 'accepted')
      .in('h2s_dispatch_jobs.status', ['accepted', 'scheduled'])
      .gte('h2s_dispatch_jobs.start_iso', new Date().toISOString())
      .order('h2s_dispatch_jobs.start_iso', { ascending: true });

    if (apptError) {
      console.error('[portal_customers] Query failed:', apptError);
      return res.status(500).json({ ok: false, error: apptError.message });
    }

    // Flatten the nested structure to match expected format
    const appointments = rawAssignments?.map(a => ({
      job_id: a.job_id,
      customer_name: a.h2s_dispatch_jobs.customer_name,
      customer_phone: a.h2s_dispatch_jobs.customer_phone,
      customer_email: a.h2s_dispatch_jobs.customer_email,
      start_iso: a.h2s_dispatch_jobs.start_iso,
      end_iso: a.h2s_dispatch_jobs.end_iso,
      status: a.h2s_dispatch_jobs.status,
      order_id: a.h2s_dispatch_jobs.order_id
    })) || [];

    // ✅ ENRICHMENT: Fetch service details from h2s_orders to fix generic "Service" names
    if (appointments && appointments.length > 0) {
        const orderIds = appointments.map(a => a.order_id).filter(id => id);
        
        if (orderIds.length > 0) {
            const { data: orders } = await supabase
                .from('h2s_orders')
                .select('order_id, service_name, items')
                .in('order_id', orderIds);
            
            if (orders) {
                const orderMap = {};
                orders.forEach(o => orderMap[o.order_id] = o);
                
                appointments.forEach(a => {
                    const order = orderMap[a.order_id];
                    if (order) {
                        // Attach items for frontend parsing
                        a.items = order.items;
                        
                        // Overwrite generic service name if better one exists
                        if ((!a.service_name || a.service_name === 'Service' || a.service_name === 'Appointment Prep') && order.service_name) {
                            a.service_name = order.service_name;
                        }
                    }
                });
            }
        }
    }

    console.log(`[portal_customers] Found ${appointments?.length || 0} customers`);

    return res.json({
      ok: true,
      customers: appointments || [],
      debug: {
        pro_id,
        assignments: debugAssignments,
        jobs: debugJobs
      }
    });

  } catch (error) {
    console.error('[portal_customers] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
