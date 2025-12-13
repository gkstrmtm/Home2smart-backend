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

    // 4. Deep Dive into Completed Jobs
    const completedAssignments = assignments?.filter(a => a.state === 'completed') || [];
    const analysis = [];

    for (const assign of completedAssignments) {
      // Fetch job details
      const { data: job } = await supabase
        .from('h2s_dispatch_jobs')
        .select('*')
        .eq('job_id', assign.job_id)
        .single();

      const { data: lines } = await supabase
        .from('h2s_dispatch_job_lines')
        .select('*')
        .eq('job_id', assign.job_id);

      const { data: teammates } = await supabase
        .from('h2s_dispatch_job_teammates')
        .select('*')
        .eq('job_id', assign.job_id)
        .maybeSingle();

      // Run Calculation
      const calc = calculatePayout(job, lines || [], teammates);
      
      // Check if ledger exists
      const hasLedger = ledger?.some(l => l.job_id === assign.job_id);

      analysis.push({
        job_id: assign.job_id,
        service: job?.resources_needed,
        has_ledger: hasLedger,
        calc_result: calc,
        lines_count: lines?.length || 0,
        metadata_payout: job?.metadata?.estimated_payout
      });
    }

    return res.json({
      ok: true,
      diagnosis: {
        pro_id: proId,
        assignments: {
          total: assignments?.length || 0,
          completed: completedAssignments.length,
        },
        ledger: {
          total: ledger?.length || 0,
        },
        analysis: analysis
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
