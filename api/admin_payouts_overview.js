import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: { bodyParser: true },
};

async function validateAdmin(token) {
  // Basic session validation; treat dispatch/admin sessions differently if you have a table.
  // For now, reuse h2s_sessions and require role=admin if present.
  const { data, error } = await supabase
    .from('h2s_sessions')
    .select('pro_id, role, expires_at')
    .eq('session_id', token)
    .single();

  if (error || !data) return null;
  if (new Date() > new Date(data.expires_at)) return null;
  if (data.role && String(data.role).toLowerCase() !== 'admin') return null;

  supabase
    .from('h2s_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', token)
    .then(() => {});

  return { admin_id: data.pro_id || 'admin' };
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

    let query = supabase
      .from('h2s_payouts_ledger')
      .select('*');

    if (status === 'approved' || status === 'pending' || status === 'paid') {
      query = query.eq('state', status);
    }
    if (start) query = query.gte('earned_at', start);
    if (end) query = query.lte('earned_at', end);

    const { data: rows, error } = await query.order('earned_at', { ascending: false });
    if (error) {
      console.error('Admin payouts query error:', error);
      return res.status(500).json({ ok: false, error: 'Query failed', error_code: 'query_error' });
    }

    // Aggregate by pro
    const byPro = {};
    for (const r of rows || []) {
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

    return res.json({ ok: true, summary, rows: rows || [] });
  } catch (e) {
    console.error('Admin payouts error:', e);
    return res.status(500).json({ ok: false, error: 'Server error: ' + e.message, error_code: 'server_error' });
  }
}
