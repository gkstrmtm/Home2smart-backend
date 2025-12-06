require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  console.log('[Test Photo Flow] ==================== START ====================');
  
  // 1. Get a test pro
  const { data: pros } = await supabase
    .from('h2s_pros')
    .select('pro_id, email, service_zip')
    .limit(1);
  
  if (!pros || pros.length === 0) {
    console.error('[Test] ❌ No pros found in database');
    process.exit(1);
  }
  
  const pro = pros[0];
  console.log('[Login] Pro:', pro.email);
  
  // 2. Login
  const loginRes = await fetch('http://localhost:3000/api/portal_login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: pro.email,
      zip: pro.service_zip
    })
  });
  
  const loginData = await loginRes.json();
  if (!loginData.ok) {
    console.error('[Login] ❌ Failed:', loginData);
    process.exit(1);
  }
  
  const token = loginData.token;
  console.log('[Login] ✅ Token:', token.substring(0, 20) + '...');
  
  // 3. Get a test job
  const { data: jobs } = await supabase
    .from('h2s_dispatch_jobs')
    .select('job_id')
    .eq('assign_state', 'upcoming')
    .limit(1);
  
  if (!jobs || jobs.length === 0) {
    console.error('[Test] ❌ No upcoming jobs found');
    process.exit(1);
  }
  
  const jobId = jobs[0].job_id;
  console.log('[Test] Using job:', jobId);
  
  // 4. Upload a test photo (1x1 red pixel PNG)
  const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const base64 = testImage.split(',')[1];
  
  console.log('[Upload] Uploading test photo...');
  const uploadRes = await fetch('http://localhost:3000/api/portal_upload_artifact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      job_id: jobId,
      type: 'photo',
      data: base64,
      filename: 'test-photo.png',
      mimetype: 'image/png'
    })
  });
  
  const uploadData = await uploadRes.json();
  console.log('[Upload] Response:', uploadData);
  
  if (!uploadData.ok) {
    console.error('[Upload] ❌ Failed:', uploadData.error);
    process.exit(1);
  }
  
  console.log('[Upload] ✅ Success - artifact_id:', uploadData.artifact_id);
  
  // 5. Fetch photos to verify
  console.log('[Get] Fetching photos for job...');
  const getRes = await fetch(`http://localhost:3000/api/portal_get_artifacts?token=${token}&job_id=${jobId}&type=photo`);
  const getData = await getRes.json();
  
  console.log('[Get] Response:', getData);
  
  if (!getData.ok || !getData.artifacts || getData.artifacts.length === 0) {
    console.error('[Get] ❌ No photos found after upload');
    process.exit(1);
  }
  
  console.log('[Get] ✅ Found', getData.artifacts.length, 'photo(s)');
  
  // 6. Delete the test photo
  console.log('[Delete] Deleting test photo...');
  const deleteRes = await fetch('http://localhost:3000/api/portal_delete_artifact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      artifact_id: uploadData.artifact_id
    })
  });
  
  const deleteData = await deleteRes.json();
  console.log('[Delete] Response:', deleteData);
  
  if (!deleteData.ok) {
    console.error('[Delete] ❌ Failed:', deleteData.error);
    process.exit(1);
  }
  
  console.log('[Delete] ✅ Success');
  
  // 7. Verify deletion
  console.log('[Verify] Checking photo was deleted...');
  const verifyRes = await fetch(`http://localhost:3000/api/portal_get_artifacts?token=${token}&job_id=${jobId}&type=photo`);
  const verifyData = await verifyRes.json();
  
  const remainingPhotos = verifyData.artifacts || [];
  const deletedPhotoStillExists = remainingPhotos.some(p => p.artifact_id === uploadData.artifact_id);
  
  if (deletedPhotoStillExists) {
    console.error('[Verify] ❌ Photo still exists after delete');
    process.exit(1);
  }
  
  console.log('[Verify] ✅ Photo successfully deleted');
  
  console.log('[Test Photo Flow] ==================== ✅✅✅ ALL TESTS PASSED ✅✅✅ ====================');
})();
