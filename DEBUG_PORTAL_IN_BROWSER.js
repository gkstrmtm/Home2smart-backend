// PASTE THIS IN BROWSER CONSOLE ON YOUR PORTAL
// This will show EXACTLY what data the portal is receiving

console.log('=== DEBUGGING PORTAL DATA ===');

// 1. Check if job exists in currentJobsData
if (window.currentJobsData) {
  console.log('\n📊 Current Jobs Data:');
  console.log('Offers:', window.currentJobsData.offers?.length || 0);
  console.log('Upcoming:', window.currentJobsData.upcoming?.length || 0);
  console.log('Completed:', window.currentJobsData.completed?.length || 0);
  
  // Find our specific job
  const targetJob = 'c5716250-6206-4f33-8678-3c2511678fac';
  const job = window.currentJobsData.offers?.find(j => j.job_id === targetJob);
  
  if (job) {
    console.log('\n✅ FOUND JOB:', targetJob);
    console.log('  distance_miles:', job.distance_miles);
    console.log('  payout_estimated:', job.payout_estimated);
    console.log('  geo_lat:', job.geo_lat);
    console.log('  geo_lng:', job.geo_lng);
    console.log('  Full job object:', job);
  } else {
    console.log('\n❌ JOB NOT FOUND IN OFFERS');
    console.log('Available job IDs:', window.currentJobsData.offers?.map(j => j.job_id));
  }
} else {
  console.log('❌ window.currentJobsData is undefined - portal not loaded yet');
}

// 2. Manually call API to see raw response
console.log('\n🌐 Fetching fresh data from API...');
fetch('/api/portal_jobs')
  .then(r => r.json())
  .then(data => {
    console.log('API Response:', data);
    const job = data.offers?.find(j => j.job_id === 'c5716250-6206-4f33-8678-3c2511678fac');
    if (job) {
      console.log('\n✅ API RETURNED JOB:');
      console.log('  distance_miles:', job.distance_miles);
      console.log('  payout_estimated:', job.payout_estimated);
    } else {
      console.log('\n❌ API DID NOT RETURN THIS JOB');
    }
  })
  .catch(err => console.error('API Error:', err));
