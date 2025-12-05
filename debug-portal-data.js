require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY; // Using Anon key as we don't have service role

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debug() {
  console.log('--- DEBUGGING PORTAL DATA ---');

  // 1. Check recent jobs
  console.log('\n1. Checking recent jobs (last 5)...');
  const { data: jobs, error: jobsError } = await supabase
    .from('h2s_dispatch_jobs')
    .select('job_id, status, customer_name, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (jobsError) {
    console.error('Error fetching jobs:', jobsError.message);
  } else {
    console.table(jobs);
  }

  // 2. Check recent assignments
  console.log('\n2. Checking recent assignments (last 5)...');
  const { data: assignments, error: assignError } = await supabase
    .from('h2s_dispatch_job_assignments')
    .select('assign_id, job_id, pro_id, state, offer_sent_at')
    .order('offer_sent_at', { ascending: false })
    .limit(5);

  if (assignError) {
    console.error('Error fetching assignments:', assignError.message);
  } else {
    console.table(assignments);
  }

  // 3. Check if get_pro_customers RPC exists
  console.log('\n3. Checking if get_pro_customers RPC is callable...');
  // We can't easily check existence without calling it, but we can try to call it with a dummy UUID
  // or check if we can query pg_proc (usually restricted)
  
  const dummyProId = '6525e19b-83af-4b25-9004-f00871695c00';
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_pro_customers', { p_pro_id: dummyProId });
  
  if (rpcError) {
    console.error('RPC Call Error:', rpcError.message);
  } else {
    console.log('RPC Call Result for Pro 6525e19b...:', rpcData);
    if (Array.isArray(rpcData)) {
        console.log(`Found ${rpcData.length} customers via RPC`);
        if (rpcData.length > 0) {
            console.log('First customer:', rpcData[0]);
        }
    }
  }

  // 4. Simulate the correct query (Manual Join) & Check Customer Data
  console.log('\n4. Simulating correct query (Manual Join) & Checking Customer Data...');
  
  // A. Get accepted assignments
  const { data: assigns, error: assignErr } = await supabase
    .from('h2s_dispatch_job_assignments')
    .select('assign_id, job_id, state')
    .eq('pro_id', dummyProId)
    .eq('state', 'accepted');

  if (assignErr) {
      console.error('Error fetching assignments:', assignErr.message);
      return;
  }

  if (!assigns || assigns.length === 0) {
      console.log('No accepted assignments found.');
      return;
  }

  console.log(`Found ${assigns.length} accepted assignments.`);
  const jobIds = assigns.map(a => a.job_id);

  // B. Get jobs and check customer linkage
  const { data: jobsData, error: jobsErr } = await supabase
    .from('h2s_dispatch_jobs')
    .select('job_id, status, customer_name, customer_id, start_iso, service_address')
    .in('job_id', jobIds);

  if (jobsErr) {
      console.error('Error fetching jobs:', jobsErr.message);
  } else {
      console.log(`Found ${jobsData.length} matching jobs. Checking customer linkage...`);
      
      for (const j of jobsData) {
          console.log(`\nJob: ${j.job_id}`);
          console.log(`- Status: ${j.status}`);
          console.log(`- Name (on Job): ${j.customer_name}`);
          console.log(`- Customer ID: ${j.customer_id}`);
          
          if (j.customer_id) {
              const { data: cust, error: custErr } = await supabase
                  .from('h2s_dispatch_customers')
                  .select('*')
                  .eq('customer_id', j.customer_id)
                  .single();
              
              if (custErr) {
                  console.log(`  ❌ Error fetching customer: ${custErr.message}`);
              } else if (!cust) {
                  console.log(`  ❌ Customer record NOT FOUND for ID ${j.customer_id}`);
              } else {
                  console.log(`  ✅ Customer Found: ${cust.name}`);
                  console.log(`     Phone: ${cust.phone}`);
                  console.log(`     Email: ${cust.email}`);
              }
          } else {
              console.log(`  ⚠️ No Customer ID linked to this job.`);
          }
      }
  }
}

debug();
