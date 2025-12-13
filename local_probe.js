import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ulbzmgmxrqyipclrbohi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsYnptZ214cnF5aXBjbHJib2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwNTAxNzksImV4cCI6MjA3ODYyNjE3OX0.zDbEkHwnTu5bjqUEyetqIYqdN6ipp15X372-a8ptCB4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log('--- STARTING LOCAL PROBE ---');

  // 0. INSPECT LEGACY TABLE
  console.log('\n--- INSPECTING LEGACY h2s_jobs ---');
  const { data: legacyJobs, error: legErr } = await supabase.from('h2s_jobs').select('*').limit(1);
  let dummyServiceId = 1; // Default guess
  if (legacyJobs && legacyJobs.length > 0) {
      console.log('Sample legacy job:', legacyJobs[0]);
      if (legacyJobs[0].service_id) {
          dummyServiceId = legacyJobs[0].service_id;
          console.log(`Using existing service_id from sample: ${dummyServiceId}`);
      }
  } else {
      console.log('No legacy jobs found to sample. Trying default ID.');
  }

  // 1. Find the Pro ID
  const partialToken = '57b6fa7f-df0e-444b-8'; 
  console.log(`\nSearching for session starting with: ${partialToken}...`);
  
  const { data: sessions, error: sessErr } = await supabase
    .from('h2s_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (sessErr) { console.error('Session lookup error:', sessErr); return; }

  const session = sessions.find(s => s.session_id.startsWith(partialToken));
  if (!session) { console.error('No matching session found.'); return; }

  const proId = session.pro_id;
  console.log(`FOUND PRO: ${proId}`);

  // 2. Get Completed Assignments
  console.log('\n--- FETCHING ASSIGNMENTS ---');
  const { data: assignments } = await supabase
    .from('h2s_dispatch_job_assignments')
    .select('*')
    .eq('pro_id', proId)
    .eq('state', 'completed');

  console.log(`Found ${assignments.length} completed assignments.`);

  // 3. Get Ledger Entries
  console.log('\n--- FETCHING LEDGER ---');
  const { data: ledger } = await supabase
    .from('h2s_payouts_ledger')
    .select('*')
    .eq('pro_id', proId);

  console.log(`Found ${ledger?.length || 0} ledger entries.`);

  // 4. Analyze Each Job
  console.log('\n--- ANALYZING JOBS ---');
  
  for (const assign of assignments) {
    console.log(`\nChecking Job: ${assign.job_id}`);
    
    const inLedger = ledger?.find(l => l.job_id === assign.job_id);
    if (inLedger) {
      console.log(` ✅ In Ledger: $${inLedger.total_amount}`);
      continue;
    } else {
      console.log(` ❌ MISSING from Ledger!`);
    }

    // Fetch Job Details
    const { data: job } = await supabase.from('h2s_dispatch_jobs').select('*').eq('job_id', assign.job_id).single();
    const { data: lines } = await supabase.from('h2s_dispatch_job_lines').select('*').eq('job_id', assign.job_id);

    // Calculate Payout
    let totalJobPayout = 0;
    if (lines && lines.length > 0) {
        lines.forEach(l => totalJobPayout += (l.calc_pro_payout_total || 0));
    }
    if (totalJobPayout === 0 && job?.metadata?.estimated_payout) {
        totalJobPayout = parseFloat(job.metadata.estimated_payout);
    }
    if (totalJobPayout === 0 && job?.resources_needed) {
        const s = String(job.resources_needed).toLowerCase();
        if (s.includes('tv')) totalJobPayout = 65;
        else if (s.includes('cam') || s.includes('security')) totalJobPayout = 85;
        else if (s.includes('thermostat')) totalJobPayout = 55;
        else if (s.includes('lock')) totalJobPayout = 60;
        else totalJobPayout = 50;
    }

    console.log(`    CALCULATED PAYOUT: $${totalJobPayout}`);

    if (totalJobPayout > 0) {
        // STEP 1: Fix the Foreign Key Constraint (The "h2s_jobs" Ghost Table)
        // Now including service_id
        const { error: shimErr } = await supabase.from('h2s_jobs').insert({
            job_id: assign.job_id,
            status: 'completed',
            service_id: dummyServiceId, // <--- ADDED THIS
            created_at: new Date().toISOString()
        });
        
        if (shimErr) {
             if (!shimErr.message.includes('duplicate key')) {
                 console.log(`    [FK Fix] Warning: ${shimErr.message}`);
             } else {
                 console.log(`    [FK Fix] Shadow record already exists.`);
             }
        } else {
             console.log(`    [FK Fix] Created shadow record in h2s_jobs`);
        }

        // STEP 2: Insert into Ledger using ONLY columns we know exist
        console.log(`    ATTEMPTING INSERT (Minimal Schema)...`);
        const { data: ins, error: insErr } = await supabase.from('h2s_payouts_ledger').insert({
            pro_id: proId,
            job_id: assign.job_id,
            amount: totalJobPayout,       
            total_amount: totalJobPayout, 
            state: 'approved'             
        }).select();

        if (insErr) {
            console.error(`    !!! INSERT FAILED: ${insErr.message}`);
        } else {
            console.log(`    !!! INSERT SUCCESS: Entry ${ins[0].entry_id}`);
        }
    } else {
        console.log(`    !!! SKIPPING INSERT (Amount is 0)`);
    }
  }
}

run();
