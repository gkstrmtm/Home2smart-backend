require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkSchema() {
  console.log('--- CHECKING JOBS SCHEMA ---');
  
  // We can't easily query information_schema via supabase-js client usually, 
  // but we can try to insert a dummy job and see if it fails on type, 
  // or just fetch a job and check the type of the returned value.
  
  const { data: jobs, error } = await supabase
    .from('h2s_dispatch_jobs')
    .select('service_zip')
    .limit(1);

  if (error) {
    console.error('Error fetching jobs:', error);
    return;
  }

  if (jobs.length > 0) {
    const zip = jobs[0].service_zip;
    console.log('service_zip value:', zip);
    console.log('service_zip type:', typeof zip);
  } else {
    console.log('No jobs found to check.');
  }
}

checkSchema();
