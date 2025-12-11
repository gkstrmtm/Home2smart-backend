const https = require('https');

const data = JSON.stringify({
  token: 'e5d4100f-fdbb-44c5-802c-0166d86ed1a8',
  status: 'all',
  days: 30
});

const options = {
  hostname: 'h2s-backend-eaamxj8fu-tabari-ropers-projects-6f2e090b.vercel.app',
  path: '/api/admin_jobs_list',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    try {
      const json = JSON.parse(responseData);
      const job = json.jobs?.[0];
      
      if (job) {
        console.log('Job ID:', job.job_id);
        console.log('Service:', job.service_name);
        console.log('\nMetadata items_json:', JSON.stringify(job.metadata?.items_json, null, 2));
        console.log('\nPurchasing suggestions count:', job.purchasing_suggestions?.length || 0);
        console.log('Purchasing suggestions:', JSON.stringify(job.purchasing_suggestions, null, 2));
      } else {
        console.log('No jobs found');
      }
    } catch (e) {
      console.error('Parse error:', e);
      console.log('Raw response:', responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('Request error:', error);
});

req.write(data);
req.end();
