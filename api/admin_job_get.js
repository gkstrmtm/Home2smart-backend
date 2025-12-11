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
  
  let { data, error } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('admin_email')
    .eq('session_id', token)
    .gte('expires_at', new Date().toISOString())
    .single();

  if (error || !data) {
    const res = await supabase
      .from('h2s_dispatch_admin_sessions')
      .select('admin_email')
      .eq('token', token)
      .gte('expires_at', new Date().toISOString())
      .single();
    
    data = res.data;
    error = res.error;
  }

  if (error || !data) return false;
  
  await supabase
    .from('h2s_dispatch_admin_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .or(`session_id.eq.${token},token.eq.${token}`);
  
  return true;
}

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

    const { token, job_id } = body;

    if (!job_id) {
      return res.status(400).json({ ok: false, error: 'Missing job_id' });
    }

    // Validate admin session
    const isValid = await validateAdminSession(token);
    if (!isValid) {
      return res.status(401).json({
        ok: false,
        error: 'Not authorized',
        error_code: 'invalid_session'
      });
    }

    // Fetch job from h2s_dispatch_jobs
    let { data: job, error: jobError } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .eq('job_id', job_id)
      .single();

    let isLegacy = false;

    if (!job || jobError) {
      // Try legacy table
      const { data: legacyJob, error: legacyError } = await supabase
        .from('h2s_jobs')
        .select('*')
        .eq('job_id', job_id)
        .single();
      
      if (legacyJob) {
        job = legacyJob;
        isLegacy = true;
      } else {
        return res.status(404).json({ ok: false, error: 'Job not found' });
      }
    }

    // Map fields if needed
    let formattedJob = { ...job };
    if (!isLegacy) {
        // Map service columns to standard names for h2s_dispatch_jobs
        formattedJob.address = job.service_address || job.address || '';
        formattedJob.city = job.service_city || job.city || '';
        formattedJob.state = job.service_state || job.state || '';
        formattedJob.zip = job.service_zip || job.zip || '';
    } else {
        // Map legacy columns
        formattedJob.address = job.service_address || job.address || '';
        formattedJob.city = job.service_city || job.city || '';
        formattedJob.state = job.service_state || job.state || '';
        formattedJob.zip = job.service_zip || job.zip || '';
        formattedJob.customer_name = job.customer_name || '';
        formattedJob.metadata = job.metadata || {};
    }

    // Fetch offers/assignments
    const { data: assignments } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('*')
      .eq('job_id', job_id);

    // Fetch pro details for assignments
    let offers = [];
    if (assignments && assignments.length > 0) {
        const proIds = [...new Set(assignments.map(a => a.pro_id))];
        
        // Try h2s_pros
        const { data: prosMain } = await supabase
            .from('h2s_pros')
            .select('pro_id, name, email, phone')
            .in('pro_id', proIds);
            
        // Try h2s_dispatch_pros
        const { data: prosDispatch } = await supabase
            .from('h2s_dispatch_pros')
            .select('pro_id, pro_name, pro_email')
            .in('pro_id', proIds);

        const prosMap = {};
        (prosMain || []).forEach(p => prosMap[p.pro_id] = { name: p.name, email: p.email, phone: p.phone });
        (prosDispatch || []).forEach(p => {
            if (!prosMap[p.pro_id]) {
                prosMap[p.pro_id] = { name: p.pro_name, email: p.pro_email, phone: '' };
            }
        });

        offers = assignments.map(a => ({
            ...a,
            pro_name: prosMap[a.pro_id]?.name || a.pro_id,
            pro_email: prosMap[a.pro_id]?.email || '',
            pro_phone: prosMap[a.pro_id]?.phone || ''
        }));
    }

    return res.status(200).json({
      ok: true,
      job: formattedJob,
      offers: offers
    });

  } catch (error) {
    console.error('[admin_job_get] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
}
