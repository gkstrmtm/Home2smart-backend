require('dotenv').config();
const https = require('https');

const VERCEL_API = 'https://h2s-backend.vercel.app/api';

// Test email and password - REPLACE WITH REAL CREDENTIALS
const TEST_EMAIL = process.env.TEST_PRO_EMAIL || 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PRO_PASSWORD || 'password';

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: Object.fromEntries(Object.entries(res.headers)),
            body: JSON.parse(data)
          });
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
  console.log('\n🎭 REAL USER FLOW TEST - Exactly what browser does\n');
  console.log('='.repeat(80));

  // Step 1: Login
  console.log('\n1️⃣  LOGIN');
  console.log('-'.repeat(80));
  
  const loginRes = await httpsRequest(`${VERCEL_API}/portal_login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
  });

  console.log(`Status: ${loginRes.status}`);
  console.log(`Response:`, JSON.stringify(loginRes.body, null, 2));

  if (!loginRes.body.ok || !loginRes.body.token) {
    console.error('\n❌ Login failed!');
    console.error('Update TEST_PRO_EMAIL and TEST_PRO_PASSWORD in .env or script');
    return;
  }

  const token = loginRes.body.token;
  console.log(`\n✅ Logged in as: ${loginRes.body.pro?.name || 'Unknown'}`);
  console.log(`Token: ${token.substring(0, 30)}...`);

  // Step 2: Get Jobs
  console.log('\n' + '='.repeat(80));
  console.log('2️⃣  FETCH JOBS (portal_jobs)');
  console.log('-'.repeat(80));

  const jobsRes = await httpsRequest(`${VERCEL_API}/portal_jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ token })
  });

  console.log(`Status: ${jobsRes.status}`);
  
  if (!jobsRes.body.ok || !jobsRes.body.jobs) {
    console.error('❌ Failed to fetch jobs');
    console.error(JSON.stringify(jobsRes.body, null, 2));
    return;
  }

  const jobs = jobsRes.body.jobs;
  console.log(`\n✅ Found ${jobs.length} jobs`);

  const jobsWithPhotos = jobs.filter(j => j.photo_count > 0);
  const jobsWithoutPhotos = jobs.filter(j => !j.photo_count || j.photo_count === 0);

  console.log(`  ${jobsWithPhotos.length} with photos (photo_count > 0)`);
  console.log(`  ${jobsWithoutPhotos.length} without photos`);

  if (jobsWithPhotos.length === 0) {
    console.log('\n⚠️  No jobs with photos found. Uploading test photo...');
    
    // Use first job for testing
    if (jobs.length === 0) {
      console.error('❌ No jobs available at all!');
      return;
    }

    const testJob = jobs[0];
    console.log(`\nUsing job: ${testJob.job_id}`);
    console.log(`Address: ${testJob.customer_address}`);

    // Create a tiny test image (1x1 red pixel PNG)
    const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

    console.log('\nUploading test photo...');
    
    const uploadRes = await httpsRequest(`${VERCEL_API}/portal_upload_artifact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        token,
        job_id: testJob.job_id,
        type: 'photo',
        data: testImage,
        filename: 'test.png',
        mimetype: 'image/png'
      })
    });

    console.log(`Upload status: ${uploadRes.status}`);
    console.log(`Upload response:`, JSON.stringify(uploadRes.body, null, 2));

    if (uploadRes.body.ok) {
      console.log('\n✅ Photo uploaded successfully!');
      // Re-fetch jobs to get updated photo_count
      const refreshRes = await httpsRequest(`${VERCEL_API}/portal_jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ token })
      });
      
      jobs.length = 0;
      jobs.push(...refreshRes.body.jobs);
      jobsWithPhotos.length = 0;
      jobsWithPhotos.push(...jobs.filter(j => j.photo_count > 0));
    }
  }

  // Step 3: Test Photo Loading for each job with photos
  console.log('\n' + '='.repeat(80));
  console.log('3️⃣  LOAD PHOTOS (portal_get_artifacts)');
  console.log('='.repeat(80));

  for (const job of jobsWithPhotos.slice(0, 3)) {  // Test first 3 jobs with photos
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`JOB: ${job.job_id}`);
    console.log(`Address: ${job.customer_address}`);
    console.log(`photo_count from jobs table: ${job.photo_count}`);
    console.log(`photo_on_file: ${job.photo_on_file}`);

    // Build URL exactly like the GET helper function does
    const queryParams = new URLSearchParams({
      token: token,
      job_id: job.job_id,
      type: 'photo'
    });

    const photoUrl = `${VERCEL_API}/portal_get_artifacts?${queryParams.toString()}`;
    
    console.log(`\nGET ${photoUrl.replace(token, token.substring(0, 15) + '...')}`);

    const photoRes = await httpsRequest(photoUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    console.log(`\nResponse Status: ${photoRes.status} ${photoRes.status === 200 ? '✅' : '❌'}`);
    
    console.log(`\nCORS Headers:`);
    console.log(`  Access-Control-Allow-Origin: ${photoRes.headers['access-control-allow-origin']}`);
    console.log(`  Access-Control-Allow-Headers: ${photoRes.headers['access-control-allow-headers']}`);
    console.log(`  Access-Control-Allow-Methods: ${photoRes.headers['access-control-allow-methods']}`);

    console.log(`\nResponse Body:`);
    console.log(JSON.stringify(photoRes.body, null, 2));

    // FRONTEND SIMULATION
    console.log(`\n${'·'.repeat(80)}`);
    console.log(`FRONTEND CODE EXECUTION:`);
    console.log(`·`.repeat(80));

    // This is EXACTLY what happens in the frontend
    const out = photoRes.body;
    
    console.log(`\n// loadJobPhotos() returns:`);
    console.log(`if (!out.ok) throw new Error(out.error);`);
    console.log(`return out.artifacts || [];`);

    let photos;
    try {
      if (!out.ok) {
        console.log(`\n❌ THROWS ERROR: ${out.error}`);
        console.log(`   Frontend catches this and returns []`);
        photos = [];
      } else {
        photos = out.artifacts || [];
        console.log(`\n✅ Returns: ${Array.isArray(photos) ? `Array[${photos.length}]` : typeof photos}`);
      }
    } catch (err) {
      console.log(`\n❌ Exception: ${err.message}`);
      photos = [];
    }

    console.log(`\n// viewPhotos() UI decision:`);
    console.log(`photos.length = ${photos.length}`);
    console.log(`if (photos.length === 0) { ... }`);

    if (photos.length === 0) {
      console.log(`\n❌ SHOWS: "No photos uploaded yet" 🖼️`);
      console.log(`\n🔴 MISMATCH DETECTED!`);
      console.log(`   Expected from jobs table: ${job.photo_count} photos`);
      console.log(`   Actually returned by API: 0 photos`);
      
      if (!out.ok) {
        console.log(`\n   Error from backend:`);
        console.log(`     error: ${out.error}`);
        console.log(`     error_code: ${out.error_code}`);
      } else {
        console.log(`\n   API says ok:true but artifacts is empty/missing`);
        console.log(`   out.artifacts = ${out.artifacts}`);
        console.log(`   out.count = ${out.count}`);
      }
    } else {
      console.log(`\n✅ SHOWS: Gallery with ${photos.length} photo(s) 📸`);
      
      if (photos.length !== job.photo_count) {
        console.log(`\n⚠️  COUNT MISMATCH:`);
        console.log(`   Jobs table says: ${job.photo_count}`);
        console.log(`   API returned: ${photos.length}`);
      } else {
        console.log(`\n✅ Count matches jobs table`);
      }

      console.log(`\n   Photos to display:`);
      photos.forEach((p, i) => {
        console.log(`\n     ${i + 1}. ${p.artifact_id?.substring(0, 8)}...`);
        console.log(`        <img src="${p.storage_url?.substring(0, 60)}..." />`);
        console.log(`        Uploaded: ${p.uploaded_at}`);
      });
    }
  }

  // Test a job WITHOUT photos
  if (jobsWithoutPhotos.length > 0) {
    const emptyJob = jobsWithoutPhotos[0];
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`4️⃣  CONTROL TEST: Job WITHOUT photos`);
    console.log('='.repeat(80));
    console.log(`Job: ${emptyJob.job_id}`);
    console.log(`photo_count: ${emptyJob.photo_count || 0}`);

    const queryParams = new URLSearchParams({
      token: token,
      job_id: emptyJob.job_id,
      type: 'photo'
    });

    const emptyPhotoUrl = `${VERCEL_API}/portal_get_artifacts?${queryParams.toString()}`;
    
    const emptyPhotoRes = await httpsRequest(emptyPhotoUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    console.log(`\nResponse: ${emptyPhotoRes.status}`);
    console.log(JSON.stringify(emptyPhotoRes.body, null, 2));

    const photos = emptyPhotoRes.body.artifacts || [];
    if (photos.length === 0) {
      console.log(`\n✅ CORRECT: Empty job returns empty array`);
    } else {
      console.log(`\n❌ ERROR: Empty job returned ${photos.length} photos!`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`SUMMARY`);
  console.log('='.repeat(80));
  console.log(`Total jobs: ${jobs.length}`);
  console.log(`Jobs with photos: ${jobsWithPhotos.length}`);
  console.log(`Jobs without photos: ${jobsWithoutPhotos.length}`);
  console.log(`\nIf you saw ❌ "No photos uploaded yet" above,`);
  console.log(`that's the exact bug the user is experiencing!`);
  console.log('='.repeat(80) + '\n');

})().catch(err => {
  console.error('\n💥 FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
