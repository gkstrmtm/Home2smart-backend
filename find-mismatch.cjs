require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const VERCEL_API = 'https://h2s-backend.vercel.app/api';

(async () => {
  console.log('\n🔍 FINDING THE ACTUAL MISMATCH\n');
  
  // Find the job with photos
  const { data: artifacts } = await supabase
    .from('h2s_dispatch_job_artifacts')
    .select('job_id, type, artifact_id, file_url')
    .eq('type', 'photo')
    .limit(5);

  console.log(`Found ${artifacts?.length} photo artifacts`);

  if (!artifacts || artifacts.length === 0) {
    console.log('No photos in DB');
    return;
  }

  const testJobId = artifacts[0].job_id;
  console.log(`\nTest Job ID: ${testJobId}`);

  // Get the job details
  const { data: job } = await supabase
    .from('h2s_dispatch_jobs')
    .select('job_id, assigned_to, photo_count, photo_on_file, customer_address')
    .eq('job_id', testJobId)
    .single();

  console.log(`\nJob Details:`);
  console.log(`  assigned_to: ${job?.assigned_to}`);
  console.log(`  photo_count: ${job?.photo_count}`);
  console.log(`  photo_on_file: ${job?.photo_on_file}`);
  console.log(`  address: ${job?.customer_address}`);

  // Get session for the assigned pro
  let token = null;
  
  if (job?.assigned_to) {
    const { data: sessions } = await supabase
      .from('h2s_sessions')
      .select('session_id')
      .eq('pro_id', job.assigned_to)
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    if (sessions && sessions.length > 0) {
      token = sessions[0].session_id;
      console.log(`\n✅ Found session for assigned pro`);
    } else {
      // Create test session
      const testToken = `test_${Date.now()}`;
      const { error } = await supabase
        .from('h2s_sessions')
        .insert({
          session_id: testToken,
          pro_id: job.assigned_to,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });

      if (!error) {
        token = testToken;
        console.log(`\n✅ Created test session`);
      }
    }
  }

  if (!token) {
    console.log('\n❌ Could not get token, using any active session');
    const { data: anySessions } = await supabase
      .from('h2s_sessions')
      .select('session_id')
      .gt('expires_at', new Date().toISOString())
      .limit(1);
    
    if (anySessions && anySessions.length > 0) {
      token = anySessions[0].session_id;
    }
  }

  if (!token) {
    console.log('❌ No token available');
    return;
  }

  console.log(`Token: ${token.substring(0, 20)}...`);

  // Now test the API
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TESTING API ENDPOINT`);
  console.log('='.repeat(80));

  const url = `${VERCEL_API}/portal_get_artifacts?token=${token}&job_id=${testJobId}&type=photo`;
  console.log(`\nGET ${url.replace(token, token.substring(0, 15) + '...')}`);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    console.log(`\nResponse: ${res.status} ${res.statusText}`);
    console.log(`\nCORS Headers:`);
    console.log(`  access-control-allow-origin: ${res.headers.get('access-control-allow-origin')}`);
    console.log(`  access-control-allow-headers: ${res.headers.get('access-control-allow-headers')}`);
    console.log(`  access-control-allow-methods: ${res.headers.get('access-control-allow-methods')}`);

    const data = await res.json();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`RESPONSE BODY`);
    console.log('='.repeat(80));
    console.log(JSON.stringify(data, null, 2));

    console.log(`\n${'='.repeat(80)}`);
    console.log(`FRONTEND SIMULATION`);
    console.log('='.repeat(80));

    // Exact frontend code simulation
    const out = data;
    console.log(`\nStep 1: API returns`);
    console.log(`  out.ok = ${out.ok}`);
    console.log(`  out.artifacts = ${Array.isArray(out.artifacts) ? `Array[${out.artifacts.length}]` : typeof out.artifacts}`);
    console.log(`  out.count = ${out.count}`);

    console.log(`\nStep 2: loadJobPhotos returns`);
    const photos = out.artifacts || [];
    console.log(`  photos = out.artifacts || []`);
    console.log(`  photos = ${Array.isArray(photos) ? `Array[${photos.length}]` : typeof photos}`);
    console.log(`  photos.length = ${photos.length}`);

    console.log(`\nStep 3: viewPhotos checks`);
    console.log(`  if (photos.length === 0) {`);
    console.log(`    // Show "No photos uploaded yet"`);
    console.log(`  } else {`);
    console.log(`    // Show gallery with photos`);
    console.log(`  }`);
    console.log(`  photos.length === 0 ? ${photos.length === 0}`);

    console.log(`\n${'='.repeat(80)}`);
    if (photos.length === 0) {
      console.log(`❌ RESULT: Shows "No photos uploaded yet"`);
      console.log('='.repeat(80));
      
      console.log(`\n🔴 MISMATCH FOUND!`);
      console.log(`  Database has: ${artifacts.length} photos for this job`);
      console.log(`  API returned: 0 photos`);
      console.log(`\nPossible causes:`);
      console.log(`  1. Backend filtering out photos (check type match, URL existence)`);
      console.log(`  2. Wrong job_id being queried`);
      console.log(`  3. Backend error not caught`);
      
      if (!out.ok) {
        console.log(`\n  Backend error: ${out.error}`);
        console.log(`  Error code: ${out.error_code}`);
      }
    } else {
      console.log(`✅ RESULT: Shows gallery with ${photos.length} photo(s)`);
      console.log('='.repeat(80));
      
      console.log(`\nPhotos that would be displayed:`);
      photos.forEach((p, i) => {
        console.log(`\n  Photo ${i + 1}:`);
        console.log(`    artifact_id: ${p.artifact_id}`);
        console.log(`    storage_url: ${p.storage_url?.substring(0, 70)}...`);
        console.log(`    uploaded_at: ${p.uploaded_at}`);
      });

      console.log(`\n✅ NO MISMATCH - Everything works correctly!`);
    }

  } catch (err) {
    console.error(`\n❌ Fetch failed: ${err.message}`);
    console.error(err.stack);
  }

})();
