require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const VERCEL_API = 'https://h2s-backend.vercel.app/api';

console.log('\n🔍 COMPREHENSIVE PHOTO FLOW MISMATCH DIAGNOSTIC\n');
console.log('='.repeat(80));

(async () => {
  // Get a session token
  const { data: sessions } = await supabase
    .from('h2s_sessions')
    .select('session_id, pro_id')
    .gt('expires_at', new Date().toISOString())
    .limit(1);

  if (!sessions || sessions.length === 0) {
    console.error('❌ No active sessions found');
    return;
  }

  const token = sessions[0].session_id;
  const proId = sessions[0].pro_id;

  console.log(`\n✅ Using session for pro: ${proId}`);
  console.log(`   Token: ${token.substring(0, 30)}...`);

  // Get jobs for this pro
  const { data: jobs } = await supabase
    .from('h2s_dispatch_jobs')
    .select('job_id, photo_count, photo_on_file, customer_address')
    .eq('assigned_to', proId)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log(`\n📋 Found ${jobs?.length || 0} jobs for this pro`);

  const jobsWithPhotos = jobs?.filter(j => j.photo_count > 0) || [];
  const jobsWithoutPhotos = jobs?.filter(j => !j.photo_count || j.photo_count === 0) || [];

  console.log(`   ${jobsWithPhotos.length} with photos`);
  console.log(`   ${jobsWithoutPhotos.length} without photos`);

  // Test 1: Job WITH photos in DB
  if (jobsWithPhotos.length > 0) {
    const testJob = jobsWithPhotos[0];
    console.log('\n' + '='.repeat(80));
    console.log('TEST 1: Job WITH photos (photo_count > 0)');
    console.log('='.repeat(80));
    console.log(`Job ID: ${testJob.job_id}`);
    console.log(`Address: ${testJob.customer_address}`);
    console.log(`photo_count: ${testJob.photo_count}`);
    console.log(`photo_on_file: ${testJob.photo_on_file}`);

    // Check actual DB records
    const { data: dbArtifacts } = await supabase
      .from('h2s_dispatch_job_artifacts')
      .select('*')
      .eq('job_id', testJob.job_id)
      .eq('type', 'photo');

    console.log(`\n📊 Database Check:`);
    console.log(`   Direct DB query found: ${dbArtifacts?.length || 0} artifacts`);
    
    if (dbArtifacts && dbArtifacts.length > 0) {
      dbArtifacts.forEach((a, i) => {
        console.log(`\n   Artifact ${i + 1}:`);
        console.log(`     artifact_id: ${a.artifact_id}`);
        console.log(`     type: "${a.type}" (exact match: ${a.type === 'photo'})`);
        console.log(`     file_url: ${a.file_url ? 'EXISTS' : 'NULL'}`);
        console.log(`     photo_url: ${a.photo_url ? 'EXISTS' : 'NULL'}`);
        console.log(`     url: ${a.url ? 'EXISTS' : 'NULL'}`);
        console.log(`     created_at: ${a.created_at}`);
        console.log(`     added_at: ${a.added_at || 'NULL'}`);
      });
    }

    // Test API endpoint
    console.log(`\n🌐 API Endpoint Test:`);
    const url1 = `${VERCEL_API}/portal_get_artifacts?token=${token}&job_id=${testJob.job_id}&type=photo`;
    
    try {
      const res1 = await fetch(url1, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      console.log(`   Status: ${res1.status} ${res1.statusText}`);
      
      const data1 = await res1.json();
      
      console.log(`\n   Response Structure:`);
      console.log(`     ok: ${data1.ok}`);
      console.log(`     count: ${data1.count}`);
      console.log(`     artifacts: ${Array.isArray(data1.artifacts) ? `Array[${data1.artifacts?.length}]` : typeof data1.artifacts}`);
      console.log(`     job_id: ${data1.job_id}`);

      if (data1.artifacts && data1.artifacts.length > 0) {
        console.log(`\n   ✅ API returned ${data1.artifacts.length} artifact(s)`);
        
        data1.artifacts.forEach((art, i) => {
          console.log(`\n   Artifact ${i + 1} from API:`);
          console.log(`     artifact_id: ${art.artifact_id}`);
          console.log(`     job_id: ${art.job_id}`);
          console.log(`     artifact_type: "${art.artifact_type}"`);
          console.log(`     storage_url: ${art.storage_url ? 'EXISTS (' + art.storage_url.substring(0, 60) + '...)' : 'NULL'}`);
          console.log(`     uploaded_at: ${art.uploaded_at}`);
          console.log(`     note: ${art.note || 'null'}`);
          console.log(`     caption: ${art.caption || 'null'}`);
          console.log(`     pro_id: ${art.pro_id || 'null'}`);
        });

        // Frontend expectation check
        console.log(`\n   🎯 Frontend Expectation Check:`);
        const firstArtifact = data1.artifacts[0];
        console.log(`     Has 'storage_url' field: ${!!firstArtifact.storage_url}`);
        console.log(`     Has 'uploaded_at' field: ${!!firstArtifact.uploaded_at}`);
        console.log(`     Has 'artifact_id' field: ${!!firstArtifact.artifact_id}`);
        
        // Simulate frontend code
        const photos = data1.artifacts || [];
        console.log(`\n   🖥️  Frontend Simulation:`);
        console.log(`     photos = out.artifacts || []`);
        console.log(`     photos.length = ${photos.length}`);
        console.log(`     photos.length === 0 ? ${photos.length === 0} (shows "no photos" if true)`);
        
        if (photos.length > 0) {
          console.log(`\n   ✅ PASS: Frontend would display ${photos.length} photo(s)`);
          console.log(`     Gallery would render with:`);
          photos.forEach((p, i) => {
            console.log(`       Photo ${i + 1}: <img src="${p.storage_url}">`);
          });
        } else {
          console.log(`\n   ❌ FAIL: Frontend would show "No photos uploaded yet"`);
        }

      } else {
        console.log(`\n   ❌ API returned EMPTY artifacts array`);
        console.log(`   This is why frontend shows "No photos uploaded yet"`);
        
        // Compare with DB
        if (dbArtifacts && dbArtifacts.length > 0) {
          console.log(`\n   🚨 MISMATCH DETECTED:`);
          console.log(`     Database has: ${dbArtifacts.length} artifacts`);
          console.log(`     API returned: 0 artifacts`);
          console.log(`\n   Possible causes:`);
          console.log(`     1. Type filter mismatch (case sensitivity?)`);
          console.log(`     2. Missing URL fields (file_url, photo_url, url all null?)`);
          console.log(`     3. Different job_id being queried`);
          console.log(`     4. Backend filtering logic excluding valid records`);
        }
      }

    } catch (err) {
      console.error(`\n   ❌ API call failed:`, err.message);
    }
  }

  // Test 2: Job WITHOUT photos
  if (jobsWithoutPhotos.length > 0) {
    const testJob = jobsWithoutPhotos[0];
    console.log('\n' + '='.repeat(80));
    console.log('TEST 2: Job WITHOUT photos (photo_count = 0)');
    console.log('='.repeat(80));
    console.log(`Job ID: ${testJob.job_id}`);
    console.log(`Address: ${testJob.customer_address}`);
    console.log(`photo_count: ${testJob.photo_count || 0}`);

    const url2 = `${VERCEL_API}/portal_get_artifacts?token=${token}&job_id=${testJob.job_id}&type=photo`;
    
    try {
      const res2 = await fetch(url2, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      const data2 = await res2.json();
      
      console.log(`\n   API Response:`);
      console.log(`     ok: ${data2.ok}`);
      console.log(`     count: ${data2.count}`);
      console.log(`     artifacts.length: ${data2.artifacts?.length || 0}`);

      if (data2.count === 0 && data2.artifacts.length === 0) {
        console.log(`\n   ✅ CORRECT: Empty job returns empty array`);
      } else {
        console.log(`\n   ⚠️  WARNING: Empty job returned ${data2.count} artifacts`);
      }

    } catch (err) {
      console.error(`\n   ❌ API call failed:`, err.message);
    }
  }

  // Test 3: Type case sensitivity
  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: Type Field Case Sensitivity Check');
  console.log('='.repeat(80));

  const { data: allArtifacts } = await supabase
    .from('h2s_dispatch_job_artifacts')
    .select('artifact_id, job_id, type')
    .limit(20);

  if (allArtifacts) {
    const typeVariations = {};
    allArtifacts.forEach(a => {
      const typeValue = a.type || 'NULL';
      typeVariations[typeValue] = (typeVariations[typeValue] || 0) + 1;
    });

    console.log(`\nType field variations in database:`);
    Object.entries(typeVariations).forEach(([type, count]) => {
      console.log(`  "${type}": ${count} records`);
      console.log(`    Matches "photo": ${type.toLowerCase() === 'photo'}`);
      console.log(`    Exact match "photo": ${type === 'photo'}`);
    });
  }

  // Test 4: URL field population
  console.log('\n' + '='.repeat(80));
  console.log('TEST 4: URL Field Population Check');
  console.log('='.repeat(80));

  const { data: photoArtifacts } = await supabase
    .from('h2s_dispatch_job_artifacts')
    .select('artifact_id, file_url, photo_url, url')
    .eq('type', 'photo')
    .limit(10);

  if (photoArtifacts && photoArtifacts.length > 0) {
    console.log(`\nChecking ${photoArtifacts.length} photo artifacts for URL fields:`);
    
    let withFileUrl = 0, withPhotoUrl = 0, withUrl = 0, withAny = 0;
    
    photoArtifacts.forEach(a => {
      if (a.file_url) withFileUrl++;
      if (a.photo_url) withPhotoUrl++;
      if (a.url) withUrl++;
      if (a.file_url || a.photo_url || a.url) withAny++;
    });

    console.log(`  ${withFileUrl} have file_url`);
    console.log(`  ${withPhotoUrl} have photo_url`);
    console.log(`  ${withUrl} have url`);
    console.log(`  ${withAny} have at least one URL field`);
    console.log(`  ${photoArtifacts.length - withAny} have NO URL fields (would be filtered out)`);

    if (withAny < photoArtifacts.length) {
      console.log(`\n  🚨 PROBLEM: ${photoArtifacts.length - withAny} photos have no URL and will be filtered out!`);
    }
  }

  // Test 5: Frontend code simulation
  console.log('\n' + '='.repeat(80));
  console.log('TEST 5: Complete Frontend Flow Simulation');
  console.log('='.repeat(80));

  if (jobsWithPhotos.length > 0) {
    const testJob = jobsWithPhotos[0];
    
    console.log(`\nSimulating: viewPhotos("${testJob.job_id}")`);
    console.log(`\n// Frontend code:`);
    console.log(`async function viewPhotos(jobId) {`);
    console.log(`  const photos = await loadJobPhotos(jobId);`);
    console.log(`  // photos.length check determines UI`);
    console.log(`  if (photos.length === 0) {`);
    console.log(`    return "No photos uploaded yet";`);
    console.log(`  } else {`);
    console.log(`    return "Display gallery with " + photos.length + " photos";`);
    console.log(`  }`);
    console.log(`}`);

    console.log(`\nasync function loadJobPhotos(jobId) {`);
    console.log(`  const out = await GET("portal_get_artifacts", {token, job_id: jobId, type: "photo"});`);
    console.log(`  if (!out.ok) throw new Error(out.error);`);
    console.log(`  return out.artifacts || [];`);
    console.log(`}`);

    // Actually call the API
    const url = `${VERCEL_API}/portal_get_artifacts?token=${token}&job_id=${testJob.job_id}&type=photo`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const out = await res.json();

    console.log(`\n// API Response:`);
    console.log(`out = ${JSON.stringify(out, null, 2)}`);

    const photos = out.artifacts || [];
    
    console.log(`\n// Variable states:`);
    console.log(`out.ok = ${out.ok}`);
    console.log(`out.artifacts = ${Array.isArray(out.artifacts) ? `Array[${out.artifacts.length}]` : out.artifacts}`);
    console.log(`photos = out.artifacts || [] = ${Array.isArray(photos) ? `Array[${photos.length}]` : photos}`);
    console.log(`photos.length = ${photos.length}`);
    console.log(`photos.length === 0 = ${photos.length === 0}`);

    console.log(`\n// UI Decision:`);
    if (photos.length === 0) {
      console.log(`❌ SHOWS: "No photos uploaded yet"`);
      console.log(`   Reason: photos.length === 0 is TRUE`);
    } else {
      console.log(`✅ SHOWS: Gallery with ${photos.length} photo(s)`);
      console.log(`   Reason: photos.length === 0 is FALSE`);
    }

    // Check what the modal HTML would render
    console.log(`\n// Modal HTML that would be rendered:`);
    if (photos.length === 0) {
      console.log(`<div>No photos uploaded yet</div>`);
    } else {
      console.log(`<div class="gallery-grid">`);
      photos.forEach((p, i) => {
        console.log(`  <img src="${p.storage_url}" /> (Photo ${i + 1})`);
      });
      console.log(`</div>`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('DIAGNOSTIC COMPLETE');
  console.log('='.repeat(80) + '\n');

})();
