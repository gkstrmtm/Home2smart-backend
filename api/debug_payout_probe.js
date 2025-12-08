import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = req.query.token || req.body.token;
    if (!token) return res.status(400).json({ error: 'No token provided' });

    // 1. Resolve Session
    const { data: session, error: sessionError } = await supabase
      .from('h2s_sessions')
      .select('pro_id, created_at')
      .eq('session_id', token)
      .single();

    if (sessionError || !session) {
      return res.json({ step: 'session', error: 'Session not found or invalid', details: sessionError });
    }

    const proId = session.pro_id;

    // 2. Check Assignments (Source of Truth for work done)
    const { data: assignments, error: assignError } = await supabase
      .from('h2s_dispatch_job_assignments')
      .select('*')
      .eq('pro_id', proId);

    // 3. Check Ledger (Source of Truth for money)
    const { data: ledger, error: ledgerError } = await supabase
      .from('h2s_payouts_ledger')
      .select('*')
      .eq('pro_id', proId);

    // 4. Check a few jobs to ensure they exist
    let jobSamples = [];
    if (assignments && assignments.length > 0) {
      const jobIds = assignments.slice(0, 3).map(a => a.job_id);
      const { data: jobs } = await supabase
        .from('h2s_dispatch_jobs')
        .select('job_id, status')
        .in('job_id', jobIds);
      jobSamples = jobs;
    }

    return res.json({
      ok: true,
      diagnosis: {
        pro_id: proId,
        assignments: {
          total: assignments?.length || 0,
          completed: assignments?.filter(a => a.state === 'completed').length || 0,
          accepted: assignments?.filter(a => a.state === 'accepted').length || 0,
          sample: assignments?.[0] || null
        },
        ledger: {
          total: ledger?.length || 0,
          sample: ledger?.[0] || null
        },
        jobs_check: jobSamples,
        mismatch: (assignments?.filter(a => a.state === 'completed').length || 0) > (ledger?.length || 0)
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
