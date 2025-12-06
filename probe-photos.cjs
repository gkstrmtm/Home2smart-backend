require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

(async () => {
  console.log('[Probe] ==================== PHOTO DIAGNOSTIC ====================');
  
  // 1. Check recent artifacts in DB
  console.log('\n[1] Checking h2s_dispatch_job_artifacts table...');
  const { data: artifacts, error: artifactsError } = await supabase
    .from('h2s_dispatch_job_artifacts')
    .select('artifact_id, job_id, type, file_url, photo_url, url, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (artifactsError) {
    console.error('❌ Error fetching artifacts:', artifactsError);
  } else {
    console.log(`✅ Found ${artifacts.length} recent artifacts:`);
    artifacts.forEach((a, i) => {
      console.log(`\n${i + 1}. Artifact ID: ${a.artifact_id}`);
      console.log(`   Job ID: ${a.job_id}`);
      console.log(`   Type: ${a.type}`);
      console.log(`   file_url: ${a.file_url || 'NULL'}`);
      console.log(`   photo_url: ${a.photo_url || 'NULL'}`);
      console.log(`   url: ${a.url || 'NULL'}`);
      console.log(`   Created: ${a.created_at}`);
    });
  }
  
  // 2. Check what jobs have photo_count > 0
  console.log('\n[2] Checking jobs with photos...');
  const { data: jobs, error: jobsError } = await supabase
    .from('h2s_dispatch_jobs')
    .select('job_id, photo_count, photo_on_file')
    .gt('photo_count', 0)
    .limit(5);
  
  if (jobsError) {
    console.error('❌ Error fetching jobs:', jobsError);
  } else {
    console.log(`✅ Found ${jobs.length} jobs with photo_count > 0:`);
    jobs.forEach((j, i) => {
      console.log(`\n${i + 1}. Job: ${j.job_id}`);
      console.log(`   photo_count: ${j.photo_count}`);
      console.log(`   photo_on_file: ${j.photo_on_file}`);
    });
  }
  
  // 3. Test the GET endpoint directly
  if (artifacts && artifacts.length > 0) {
    const testJobId = artifacts[0].job_id;
    console.log(`\n[3] Testing portal_get_artifacts endpoint for job: ${testJobId}`);
    
    // Login first to get token
    const { data: pros } = await supabase
      .from('h2s_pros')
      .select('email, service_zip')
      .limit(1);
    
    if (pros && pros.length > 0) {
      const loginRes = await fetch('http://localhost:3000/api/portal_login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: pros[0].email,
          zip: pros[0].service_zip
        })
      });
      
      const loginData = await loginRes.json();
      
      if (loginData.ok) {
        const token = loginData.token;
        console.log(`   ✅ Got token: ${token.substring(0, 20)}...`);
        
        // Now test get artifacts
        const getUrl = `http://localhost:3000/api/portal_get_artifacts?token=${token}&job_id=${testJobId}&type=photo`;
        console.log(`   Fetching: ${getUrl}`);
        
        const getRes = await fetch(getUrl);
        const getData = await getRes.json();
        
        console.log(`\n   Response:`, JSON.stringify(getData, null, 2));
        
        if (getData.ok && getData.artifacts) {
          console.log(`\n   ✅ Endpoint returned ${getData.artifacts.length} artifact(s)`);
          getData.artifacts.forEach((a, i) => {
            console.log(`\n   Photo ${i + 1}:`);
            console.log(`     artifact_id: ${a.artifact_id}`);
            console.log(`     storage_url: ${a.storage_url}`);
            console.log(`     uploaded_at: ${a.uploaded_at}`);
          });
        } else {
          console.log(`   ❌ Endpoint returned no artifacts or error`);
        }
      }
    }
  }
  
  console.log('\n[Probe] ==================== END DIAGNOSTIC ====================');
})();
