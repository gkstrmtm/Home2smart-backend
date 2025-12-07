const https = require('https');

const VERCEL_API = 'https://home2smart-backend.vercel.app/api';

// Test credentials (replace with real ones)
const TEST_EMAIL = 'your-test-email@example.com';
const TEST_PASSWORD = 'your-test-password';

async function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ 
                        status: res.statusCode, 
                        headers: res.headers,
                        body: JSON.parse(data) 
                    });
                } catch (e) {
                    resolve({ 
                        status: res.statusCode, 
                        headers: res.headers,
                        body: data 
                    });
                }
            });
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(options.body);
        }
        
        req.end();
    });
}

async function testPhotoFlow() {
    console.log('\n==================== PHOTO FLOW TEST ====================\n');
    
    // Step 1: Login
    console.log('1️⃣  Testing login...');
    const loginRes = await makeRequest(`${VERCEL_API}/portal_login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({ 
            email: TEST_EMAIL, 
            password: TEST_PASSWORD 
        })
    });
    
    console.log('Login status:', loginRes.status);
    console.log('Login response:', JSON.stringify(loginRes.body, null, 2));
    
    if (!loginRes.body.ok || !loginRes.body.token) {
        console.error('❌ Login failed');
        return;
    }
    
    const token = loginRes.body.token;
    console.log('✅ Token:', token.substring(0, 30) + '...\n');
    
    // Step 2: Get jobs
    console.log('2️⃣  Fetching jobs...');
    const jobsRes = await makeRequest(`${VERCEL_API}/portal_jobs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ token })
    });
    
    console.log('Jobs status:', jobsRes.status);
    console.log('Jobs count:', jobsRes.body.jobs?.length || 0);
    
    if (!jobsRes.body.ok || !jobsRes.body.jobs) {
        console.error('❌ Failed to fetch jobs');
        return;
    }
    
    const jobsWithPhotos = jobsRes.body.jobs.filter(j => j.photo_count > 0);
    console.log('Jobs with photos:', jobsWithPhotos.length);
    
    if (jobsWithPhotos.length === 0) {
        console.warn('⚠️  No jobs with photos found, using first job');
    }
    
    const testJob = jobsWithPhotos[0] || jobsRes.body.jobs[0];
    if (!testJob) {
        console.error('❌ No jobs available');
        return;
    }
    
    const jobId = testJob.job_id;
    console.log('✅ Test job ID:', jobId);
    console.log('   Photo count:', testJob.photo_count || 0);
    console.log('   Address:', testJob.customer_address);
    console.log('');
    
    // Step 3: Load photos (using query string like GET helper)
    console.log('3️⃣  Loading photos via GET with query string...');
    const queryParams = new URLSearchParams({
        token: token,
        job_id: jobId,
        type: 'photo'
    });
    
    const getUrl = `${VERCEL_API}/portal_get_artifacts?${queryParams.toString()}`;
    console.log('GET URL:', getUrl);
    
    const photosRes1 = await makeRequest(getUrl, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });
    
    console.log('Photos GET status:', photosRes1.status);
    console.log('Photos GET CORS headers:', {
        'access-control-allow-origin': photosRes1.headers['access-control-allow-origin'],
        'access-control-allow-headers': photosRes1.headers['access-control-allow-headers'],
        'access-control-allow-methods': photosRes1.headers['access-control-allow-methods']
    });
    console.log('Photos GET response:', JSON.stringify(photosRes1.body, null, 2));
    console.log('');
    
    // Step 4: Also test POST method
    console.log('4️⃣  Loading photos via POST with body...');
    const photosRes2 = await makeRequest(`${VERCEL_API}/portal_get_artifacts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            token: token,
            job_id: jobId,
            type: 'photo'
        })
    });
    
    console.log('Photos POST status:', photosRes2.status);
    console.log('Photos POST response:', JSON.stringify(photosRes2.body, null, 2));
    console.log('');
    
    // Summary
    console.log('\n==================== SUMMARY ====================');
    console.log('Login:', loginRes.body.ok ? '✅' : '❌');
    console.log('Jobs fetch:', jobsRes.body.ok ? '✅' : '❌');
    console.log('Photos GET:', photosRes1.body.ok ? `✅ (${photosRes1.body.count} photos)` : '❌');
    console.log('Photos POST:', photosRes2.body.ok ? `✅ (${photosRes2.body.count} photos)` : '❌');
    
    if (photosRes1.body.ok && photosRes1.body.count > 0) {
        console.log('\n📸 Sample photo:');
        console.log(JSON.stringify(photosRes1.body.artifacts[0], null, 2));
    }
    
    console.log('\n=====================================================\n');
}

// Run test
testPhotoFlow().catch(err => {
    console.error('💥 FATAL ERROR:', err);
    process.exit(1);
});
