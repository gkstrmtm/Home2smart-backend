require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const VERCEL_API = 'https://h2s-backend.vercel.app/api';

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

(async () => {
  console.log('\n🔍 PHOTO LOADING MISMATCH HUNTER\n');

  // Get an active session
  const { data: sessions } = await supabase
    .from('h2s_sessions')
    .select('session_id, pro_id')
    .gt('expires_at', new Date().toISOString())
    .order('last_seen_at', { ascending: false })
    .limit(1);

  if (!sessions || sessions.length === 0) {
    console.log('❌ No active sessions. Login to portal first.');
    return;
  }

  const token = sessions[0].session_id;
  const proId = sessions[0].pro_id;

  console.log(`Using session for pro: ${proId}`);
  console.log(`Token: ${token.substring(0, 25)}...\n`);

  // Get jobs via API (exact same request the frontend makes)
  console.log('📡 Fetching jobs via API...\n');
  
  const jobsRes = await httpsRequest(`${VERCEL_API}/portal_jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ token })
  });

  if (!jobsRes.body.ok) {
    console.log('❌ Failed to fetch jobs');
    console.log(JSON.stringify(jobsRes.body, null, 2));
    return;
  }

  // portal_jobs returns {offers, upcoming, completed} not {jobs}
  const jobs = [
    ...(jobsRes.body.offers || []),
    ...(jobsRes.body.upcoming || []),
    ...(jobsRes.body.completed || [])
  ];
  
  const jobsWithPhotos = jobs.filter(j => j.photo_count > 0);

  console.log(`✅ Found ${jobs.length} total jobs`);
  console.log(`📸 ${jobsWithPhotos.length} jobs have photos\n`);

  if (jobsWithPhotos.length === 0) {
    console.log('⚠️  No jobs with photos. Testing complete - nothing to diagnose.\n');
    return;
  }

  // Test each job with photos
  console.log('='.repeat(80));
  console.log('TESTING PHOTO LOADING FOR EACH JOB');
  console.log('='.repeat(80) + '\n');

  for (const job of jobsWithPhotos) {
    console.log(`\n${'-'.repeat(80)}`);
    console.log(`JOB: ${job.job_id}`);
    console.log(`Address: ${job.customer_address}`);
    console.log(`photo_count: ${job.photo_count}`);
    console.log('-'.repeat(80));

    // Exactly what the GET helper does
    const queryParams = new URLSearchParams({
      token: token,
      job_id: job.job_id,
      type: 'photo'
    });

    const url = `${VERCEL_API}/portal_get_artifacts?${queryParams.toString()}`;
    
    console.log(`\nGET ${url.replace(token, 'TOKEN...')}`);

    const photoRes = await httpsRequest(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    console.log(`\nHTTP ${photoRes.status}`);

    const out = photoRes.body;

    // Frontend code simulation
    console.log(`\n// Backend Response:`);
    console.log(`out.ok = ${out.ok}`);
    console.log(`out.count = ${out.count}`);
    console.log(`out.artifacts = ${Array.isArray(out.artifacts) ? `Array[${out.artifacts.length}]` : out.artifacts}`);

    console.log(`\n// Frontend Code:`);
    console.log(`const photos = out.artifacts || [];`);
    
    const photos = out.artifacts || [];
    
    console.log(`photos.length = ${photos.length}`);
    console.log(`\nif (photos.length === 0) {`);
    console.log(`  // Show "No photos uploaded yet"`);
    console.log(`} else {`);
    console.log(`  // Show gallery`);
    console.log(`}`);

    console.log(`\n${'='.repeat(80)}`);
    if (photos.length === 0) {
      console.log(`❌ RESULT: "No photos uploaded yet" 🖼️`);
      console.log('='.repeat(80));
      
      console.log(`\n🔴 BUG CONFIRMED!`);
      console.log(`   Jobs table says: ${job.photo_count} photos`);
      console.log(`   API returned: 0 photos`);
      
      if (!out.ok) {
        console.log(`\n   Backend error:`);
        console.log(`     ${out.error} (${out.error_code})`);
      } else {
        console.log(`\n   Backend says ok:true but returned empty array`);
      }

      // Check database directly
      const { data: dbCheck } = await supabase
        .from('h2s_dispatch_job_artifacts')
        .select('artifact_id, type, file_url, photo_url, url')
        .eq('job_id', job.job_id)
        .eq('type', 'photo');

      console.log(`\n   Direct DB check: ${dbCheck?.length || 0} photos found`);
      
      if (dbCheck && dbCheck.length > 0) {
        console.log(`\n   🚨 MISMATCH: DB has photos but API returned none!`);
        console.log(`\n   Checking DB records:`);
        dbCheck.forEach((rec, i) => {
          console.log(`\n     Photo ${i + 1}:`);
          console.log(`       type: "${rec.type}"`);
          console.log(`       file_url: ${rec.file_url ? 'EXISTS' : 'NULL'}`);
          console.log(`       photo_url: ${rec.photo_url ? 'EXISTS' : 'NULL'}`);
          console.log(`       url: ${rec.url ? 'EXISTS' : 'NULL'}`);
          const hasUrl = !!(rec.file_url || rec.photo_url || rec.url);
          console.log(`       has_url: ${hasUrl ? '✅' : '❌ MISSING - WILL BE FILTERED OUT'}`);
        });
      }

    } else {
      console.log(`✅ RESULT: Gallery with ${photos.length} photo(s) 📸`);
      console.log('='.repeat(80));
      
      if (photos.length === job.photo_count) {
        console.log(`\n✅ Count matches! Everything working correctly.`);
      } else {
        console.log(`\n⚠️  COUNT MISMATCH:`);
        console.log(`   Expected: ${job.photo_count}`);
        console.log(`   Got: ${photos.length}`);
      }

      console.log(`\n   Photos:`);
      photos.forEach((p, i) => {
        console.log(`     ${i + 1}. ${p.storage_url?.substring(0, 70)}...`);
      });
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('DIAGNOSTIC COMPLETE');
  console.log('='.repeat(80) + '\n');

})();
