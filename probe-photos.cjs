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
    
    // Get a pro with an active session
    const { data: sessions } = await supabase
      .from('h2s_sessions')
      .select('session_id, pro_id, expires_at')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    
    let token = null;
    
    if (sessions && sessions.length > 0) {
      token = sessions[0].session_id;
      console.log(`   ✅ Using existing session token: ${token.substring(0, 20)}...`);
    } else {
      // Create test session if none exist
      console.log(`   ⚠️  No active sessions found, creating test session...`);
      
      const { data: pros } = await supabase
        .from('h2s_pros')
        .select('pro_id, email')
        .limit(1);
      
      if (pros && pros.length > 0) {
        const testToken = `test_${Date.now()}_${Math.random().toString(36).substr(2)}`;
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        const { error: sessionError } = await supabase
          .from('h2s_sessions')
          .insert({
            session_id: testToken,
            pro_id: pros[0].pro_id,
            expires_at: expiresAt,
            created_at: new Date().toISOString()
          });
        
        if (!sessionError) {
          token = testToken;
          console.log(`   ✅ Created test session: ${token.substring(0, 20)}...`);
        }
      }
    }
    
    if (token) {
      // Now test get artifacts via Vercel
      const VERCEL_API = 'https://h2s-backend.vercel.app/api';
      const getUrl = `${VERCEL_API}/portal_get_artifacts?token=${token}&job_id=${testJobId}&type=photo`;
      console.log(`   📡 Fetching: ${getUrl.replace(token, token.substring(0, 20) + '...')}`);
      
      try {
        const getRes = await fetch(getUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
        
        console.log(`   📨 Response status: ${getRes.status} ${getRes.statusText}`);
        console.log(`   📨 CORS headers:`, {
          'access-control-allow-origin': getRes.headers.get('access-control-allow-origin'),
          'access-control-allow-headers': getRes.headers.get('access-control-allow-headers'),
          'access-control-allow-methods': getRes.headers.get('access-control-allow-methods')
        });
        
        const getData = await getRes.json();
        
        console.log(`\n   📦 Response:`, JSON.stringify(getData, null, 2));
        
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
          console.log(`   Error code: ${getData.error_code}`);
          console.log(`   Error message: ${getData.error}`);
        }
      } catch (err) {
        console.error(`   ❌ Fetch failed:`, err.message);
      }
    } else {
      console.log(`   ❌ Could not get or create session token`);
    }
  }
  
  console.log('\n[Probe] ==================== END DIAGNOSTIC ====================');
})();
