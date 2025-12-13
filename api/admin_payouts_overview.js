import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: { bodyParser: true },
};

async function validateAdmin(token) {
  if (!token) return null;
  
  // Check dispatch admin sessions table (try session_id first)
  let { data, error } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('admin_email')
    .eq('session_id', token)
    .gte('expires_at', new Date().toISOString())
    .single();

  // Fallback to token field
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

  if (error || !data) return null;

  // Update last seen (try both fields)
  await supabase
    .from('h2s_dispatch_admin_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', token);

  return { admin_email: data.admin_email };
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
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);

    const token = body?.token || req.query?.token;
    const status = (body?.status || req.query?.status || 'all').toLowerCase();
    const start = body?.start || req.query?.start; // ISO date
    const end = body?.end || req.query?.end;       // ISO date

    const admin = await validateAdmin(token);
    if (!admin) {
      return res.status(401).json({ ok: false, error: 'Unauthorized', error_code: 'bad_session' });
    }

    // 1. Fetch Payouts
    let query = supabase
      .from('h2s_payouts_ledger')
      .select('*');

    if (status === 'approved' || status === 'pending' || status === 'paid') {
      query = query.eq('state', status);
    }
    if (start) query = query.gte('created_at', start);
    if (end) query = query.lte('created_at', end);

    const { data: rows, error } = await query.order('created_at', { ascending: false });
    if (error) {
      console.error('Admin payouts query error:', error);
      return res.status(500).json({ ok: false, error: 'Query failed', error_code: 'query_error' });
    }

    // 2. Fetch Associated Jobs (Manual Join for Safety)
    const jobIds = [...new Set((rows || []).map(r => r.job_id).filter(Boolean))];
    const jobsMap = {};
    
    if (jobIds.length > 0) {
        const { data: jobs } = await supabase
            .from('h2s_dispatch_jobs')
            .select('job_id, customer_name, service_address, service_city, service_state, service_zip, metadata')
            .in('job_id', jobIds);
            
        (jobs || []).forEach(j => jobsMap[j.job_id] = j);
    }

    // 3. Merge Data
    const enrichedRows = (rows || []).map(r => {
        const job = jobsMap[r.job_id] || {};
        const meta = job.metadata || {};
        
        return {
            ...r,
            customer_name: r.customer_name || job.customer_name || meta.customer_name || meta.shipping_name || 'Customer',
            service_address: r.service_address || job.service_address || meta.service_address || meta.address || '',
            service_city: r.service_city || job.service_city || meta.service_city || meta.city || '',
            service_state: r.service_state || job.service_state || meta.service_state || meta.state || '',
            service_zip: r.service_zip || job.service_zip || meta.service_zip || meta.zip || '',
            job_metadata: meta // Pass metadata for frontend service parsing
        };
    });

    // Aggregate by pro
    const byPro = {};
    for (const r of enrichedRows) {
      const key = r.pro_id || 'unknown';
      if (!byPro[key]) {
        byPro[key] = {
          pro_id: key,
          totals: { approved: 0, pending: 0, paid: 0, lifetime: 0 },
          count: 0,
          entries: [],
        };
      }
      const amt = Number(r.total_amount || r.amount || 0) || 0;
      const st = String(r.state || '').toLowerCase();
      if (st === 'approved') byPro[key].totals.approved += amt;
      else if (st === 'pending') byPro[key].totals.pending += amt;
      else if (st === 'paid') byPro[key].totals.paid += amt;
      byPro[key].totals.lifetime += (st === 'approved' || st === 'paid') ? amt : 0;
      byPro[key].entries.push(r);
      byPro[key].count++;
    }

    const summary = Object.values(byPro).sort((a,b) => b.totals.approved - a.totals.approved);

    return res.json({ ok: true, summary, rows: enrichedRows });
  } catch (e) {
    console.error('Admin payouts error:', e);
    return res.status(500).json({ ok: false, error: 'Server error: ' + e.message, error_code: 'server_error' });
  }
}
