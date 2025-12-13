const https = require('https');

// Performance testing suite for dispatch dashboard
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m'
};

const API_BASE = 'h2s-backend-eaamxj8fu-tabari-ropers-projects-6f2e090b.vercel.app';
const TOKEN = 'e5d4100f-fdbb-44c5-802c-0166d86ed1a8';

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function makeRequest(path, method = 'POST', body = null) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        
        const data = body ? JSON.stringify(body) : '';
        const options = {
            hostname: API_BASE,
            path: `/api/${path}`,
            method: method,
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
                const duration = Date.now() - startTime;
                try {
                    const json = JSON.parse(responseData);
                    resolve({ json, duration, status: res.statusCode });
                } catch (e) {
                    reject({ error: 'Parse error', duration, raw: responseData });
                }
            });
        });

        req.on('error', (error) => {
            const duration = Date.now() - startTime;
            reject({ error: error.message, duration });
        });

        if (data) {
            req.write(data);
        }
        req.end();
    });
}

async function testJobsList() {
    log('\n📋 Testing Jobs List API', colors.cyan);
    log('='.repeat(60), colors.cyan);
    
    try {
        const { json, duration } = await makeRequest('admin_jobs_list', 'POST', {
            token: TOKEN,
            status: 'all',
            days: 30
        });
        
        const jobCount = json.jobs?.length || 0;
        const avgJobSize = JSON.stringify(json).length / jobCount;
        
        log(`✓ Response time: ${duration}ms`, duration < 1000 ? colors.green : colors.yellow);
        log(`✓ Jobs returned: ${jobCount}`, colors.green);
        log(`✓ Average job size: ${Math.round(avgJobSize)} bytes`, colors.reset);
        log(`✓ Total payload: ${Math.round(JSON.stringify(json).length / 1024)}KB`, colors.reset);
        
        // Test data completeness
        const sampleJob = json.jobs?.[0];
        if (sampleJob) {
            log('\n📊 Sample Job Data Completeness:', colors.bright);
            log(`  - job_id: ${sampleJob.job_id ? '✓' : '✗'}`, sampleJob.job_id ? colors.green : colors.red);
            log(`  - metadata: ${sampleJob.metadata ? '✓' : '✗'}`, sampleJob.metadata ? colors.green : colors.red);
            log(`  - items_json: ${sampleJob.metadata?.items_json ? '✓' : '✗'}`, sampleJob.metadata?.items_json ? colors.green : colors.red);
            log(`  - purchasing_suggestions: ${sampleJob.purchasing_suggestions?.length || 0} items`, 
                sampleJob.purchasing_suggestions?.length > 0 ? colors.green : colors.yellow);
            log(`  - assigned_pro_name: ${sampleJob.assigned_pro_name || 'Unassigned'}`, 
                sampleJob.assigned_pro_name ? colors.green : colors.yellow);
            log(`  - assigned_pro_phone: ${sampleJob.assigned_pro_phone || 'N/A'}`, 
                sampleJob.assigned_pro_phone ? colors.green : colors.yellow);
        }
        
        return { jobCount, duration, jobs: json.jobs };
    } catch (err) {
        log(`✗ Error: ${err.error} (${err.duration}ms)`, colors.red);
        return null;
    }
}

async function testJobPhotos(jobId) {
    log(`\n📷 Testing Job Photos API (${jobId})`, colors.cyan);
    log('='.repeat(60), colors.cyan);
    
    const types = ['photo', 'customer_photo'];
    const results = {};
    
    for (const type of types) {
        try {
            const { json, duration } = await makeRequest('portal_get_artifacts', 'POST', {
                token: TOKEN,
                job_id: jobId,
                type: type
            });
            
            const photoCount = json.artifacts?.length || 0;
            results[type] = { photoCount, duration };
            
            log(`✓ ${type}: ${photoCount} photos in ${duration}ms`, 
                duration < 500 ? colors.green : colors.yellow);
        } catch (err) {
            log(`✗ ${type}: Error (${err.duration}ms)`, colors.red);
            results[type] = { error: true, duration: err.duration };
        }
    }
    
    return results;
}

async function testBusinessIntelligence() {
    log('\n📊 Testing Business Intelligence API', colors.cyan);
    log('='.repeat(60), colors.cyan);
    
    try {
        const { json, duration } = await makeRequest('admin_business_intelligence', 'POST', {
            token: TOKEN
        });
        
        log(`✓ Response time: ${duration}ms`, duration < 2000 ? colors.green : colors.yellow);
        log(`✓ Total revenue: $${json.total_revenue || 0}`, colors.green);
        log(`✓ Total jobs: ${json.total_jobs || 0}`, colors.green);
        log(`✓ City revenue calculated: ${json.city_revenue ? '✓' : '✗'}`, json.city_revenue ? colors.green : colors.red);
        
        return { duration };
    } catch (err) {
        log(`✗ Error: ${err.error} (${err.duration}ms)`, colors.red);
        return null;
    }
}

async function testSequentialModalOpen(jobs) {
    log('\n⚡ Testing Sequential Modal Open (Current Behavior)', colors.cyan);
    log('='.repeat(60), colors.cyan);
    
    const testJob = jobs[0];
    const timings = {
        jobData: 0, // Already loaded from jobs list
        techPhotos: 0,
        customerPhotos: 0
    };
    
    log('Step 1: Job data (cached from list)', colors.reset);
    log(`  ✓ Already loaded: 0ms`, colors.green);
    
    log('Step 2: Load tech photos', colors.reset);
    const techStart = Date.now();
    const techPhotos = await makeRequest('portal_get_artifacts', 'POST', {
        token: TOKEN,
        job_id: testJob.job_id,
        type: 'photo'
    });
    timings.techPhotos = Date.now() - techStart;
    log(`  ✓ Tech photos: ${timings.techPhotos}ms (${techPhotos.json.artifacts?.length || 0} photos)`, 
        timings.techPhotos < 500 ? colors.green : colors.yellow);
    
    log('Step 3: Load customer photos', colors.reset);
    const custStart = Date.now();
    const custPhotos = await makeRequest('portal_get_artifacts', 'POST', {
        token: TOKEN,
        job_id: testJob.job_id,
        type: 'customer_photo'
    });
    timings.customerPhotos = Date.now() - custStart;
    log(`  ✓ Customer photos: ${timings.customerPhotos}ms (${custPhotos.json.artifacts?.length || 0} photos)`, 
        timings.customerPhotos < 500 ? colors.green : colors.yellow);
    
    const totalTime = timings.techPhotos + timings.customerPhotos;
    log(`\n⏱️  TOTAL MODAL OPEN TIME: ${totalTime}ms`, totalTime < 1000 ? colors.green : colors.yellow);
    
    return timings;
}

async function testParallelModalOpen(jobs) {
    log('\n⚡ Testing Parallel Modal Open (Optimized)', colors.cyan);
    log('='.repeat(60), colors.cyan);
    
    const testJob = jobs[0];
    
    log('Loading tech + customer photos in parallel...', colors.reset);
    const startTime = Date.now();
    
    const [techPhotos, custPhotos] = await Promise.all([
        makeRequest('portal_get_artifacts', 'POST', {
            token: TOKEN,
            job_id: testJob.job_id,
            type: 'photo'
        }),
        makeRequest('portal_get_artifacts', 'POST', {
            token: TOKEN,
            job_id: testJob.job_id,
            type: 'customer_photo'
        })
    ]);
    
    const totalTime = Date.now() - startTime;
    
    log(`✓ Tech photos: ${techPhotos.json.artifacts?.length || 0} photos`, colors.green);
    log(`✓ Customer photos: ${custPhotos.json.artifacts?.length || 0} photos`, colors.green);
    log(`\n⏱️  TOTAL MODAL OPEN TIME: ${totalTime}ms`, totalTime < 600 ? colors.green : colors.yellow);
    
    return totalTime;
}

async function runFullSuite() {
    log('\n' + '='.repeat(60), colors.bright);
    log('🚀 DISPATCH DASHBOARD PERFORMANCE TEST SUITE', colors.bright);
    log('='.repeat(60) + '\n', colors.bright);
    
    const results = {};
    
    // Test 1: Jobs List
    const jobsTest = await testJobsList();
    if (jobsTest) {
        results.jobsList = jobsTest;
    }
    
    // Test 2: Business Intelligence
    const biTest = await testBusinessIntelligence();
    if (biTest) {
        results.businessIntelligence = biTest;
    }
    
    // Test 3: Job Photos (if we have jobs)
    if (jobsTest && jobsTest.jobs?.length > 0) {
        const photosTest = await testJobPhotos(jobsTest.jobs[0].job_id);
        results.photos = photosTest;
        
        // Test 4: Sequential vs Parallel
        const sequentialTime = await testSequentialModalOpen(jobsTest.jobs);
        const parallelTime = await testParallelModalOpen(jobsTest.jobs);
        
        results.modalPerformance = { sequentialTime, parallelTime };
    }
    
    // Summary
    log('\n' + '='.repeat(60), colors.bright);
    log('📈 PERFORMANCE SUMMARY', colors.bright);
    log('='.repeat(60), colors.bright);
    
    if (results.jobsList) {
        log(`\nJobs List API: ${results.jobsList.duration}ms for ${results.jobsList.jobCount} jobs`, colors.cyan);
    }
    
    if (results.businessIntelligence) {
        log(`Business Intelligence: ${results.businessIntelligence.duration}ms`, colors.cyan);
    }
    
    if (results.modalPerformance) {
        const sequential = results.modalPerformance.sequentialTime.techPhotos + 
                          results.modalPerformance.sequentialTime.customerPhotos;
        const parallel = results.modalPerformance.parallelTime;
        const improvement = Math.round(((sequential - parallel) / sequential) * 100);
        
        log(`\nModal Open Performance:`, colors.cyan);
        log(`  Sequential: ${sequential}ms`, colors.yellow);
        log(`  Parallel: ${parallel}ms`, colors.green);
        log(`  Improvement: ${improvement}% faster`, improvement > 30 ? colors.green : colors.yellow);
    }
    
    log('\n' + '='.repeat(60), colors.bright);
    log('✅ RECOMMENDATIONS', colors.bright);
    log('='.repeat(60), colors.bright);
    
    log('\n1. Load photos in PARALLEL (not sequential)', colors.green);
    log('2. Pre-fetch photos for visible jobs on dashboard load', colors.green);
    log('3. Implement optimistic UI (show skeleton immediately)', colors.green);
    log('4. Cache all photo requests for 5 minutes', colors.green);
    log('5. Lazy-load images below the fold', colors.green);
    
    log('\n');
}

// Run the suite
runFullSuite().catch(err => {
    log(`Fatal error: ${err}`, colors.red);
    process.exit(1);
});
