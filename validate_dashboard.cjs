const fs = require('fs');
const https = require('https');

const API_BASE = 'h2s-backend-6hvxj0mez-tabari-ropers-projects-6f2e090b.vercel.app';
const TOKEN = 'e5d4100f-fdbb-44c5-802c-0166d86ed1a8';

console.log('🔍 COMPREHENSIVE DASHBOARD VALIDATION\n');
console.log('='.repeat(60));

// Test 1: Check HTML file exists and is valid
console.log('\n📄 Test 1: HTML File Validation');
try {
    const html = fs.readFileSync('dispatch.html', 'utf8');
    console.log(`  ✓ File exists (${Math.round(html.length / 1024)}KB)`);
    
    // Check for common syntax issues
    const issues = [];
    
    if (html.includes('\\n                ')) {
        issues.push('Contains literal \\n in code');
    }
    
    if (html.includes('undefined') && !html.includes('!== undefined')) {
        console.log('  ⚠ Contains "undefined" (might be intentional)');
    }
    
    const apiBaseMatch = html.match(/API_BASE = '([^']+)'/);
    if (apiBaseMatch) {
        console.log(`  ✓ API_BASE: ${apiBaseMatch[1]}`);
        if (!apiBaseMatch[1].includes('h2s-backend-6hvxj0mez')) {
            issues.push(`API_BASE points to old deployment: ${apiBaseMatch[1]}`);
        }
    }
    
    if (issues.length > 0) {
        console.log('  ✗ Issues found:');
        issues.forEach(i => console.log(`    - ${i}`));
    } else {
        console.log('  ✓ No syntax issues detected');
    }
} catch (err) {
    console.log(`  ✗ Error: ${err.message}`);
}

// Test 2: Validate all API endpoints
console.log('\n🌐 Test 2: API Endpoints');

async function testAPI(name, path, body) {
    return new Promise((resolve) => {
        const data = JSON.stringify(body);
        const options = {
            hostname: API_BASE,
            path: `/api/${path}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(responseData);
                    resolve({
                        name,
                        status: res.statusCode,
                        ok: json.ok,
                        error: json.error,
                        hasData: Object.keys(json).length > 2
                    });
                } catch (e) {
                    resolve({ name, status: res.statusCode, error: 'Parse error' });
                }
            });
        });

        req.on('error', (error) => {
            resolve({ name, error: error.message });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ name, error: 'Timeout' });
        });

        req.write(data);
        req.end();
    });
}

async function runAPITests() {
    const endpoints = [
        { name: 'Business Intelligence', path: 'admin_business_intelligence', body: { token: TOKEN } },
        { name: 'Jobs List', path: 'admin_jobs_list', body: { token: TOKEN, status: 'all', days: 30 } },
        { name: 'Artifacts (customer)', path: 'portal_get_artifacts', body: { token: TOKEN, job_id: '1c2cf924-471a-47cb-a9b4-f35d98eb75b1', type: 'customer_photo' } },
        { name: 'Artifacts (tech)', path: 'portal_get_artifacts', body: { token: TOKEN, job_id: '1c2cf924-471a-47cb-a9b4-f35d98eb75b1', type: 'photo' } }
    ];

    for (const endpoint of endpoints) {
        const result = await testAPI(endpoint.name, endpoint.path, endpoint.body);
        
        if (result.status === 200 && result.ok) {
            console.log(`  ✓ ${endpoint.name}: OK (${result.status})`);
        } else if (result.status === 200 && result.hasData) {
            console.log(`  ✓ ${endpoint.name}: OK (${result.status}) - no ok field but has data`);
        } else {
            console.log(`  ✗ ${endpoint.name}: ${result.error || 'FAIL'} (${result.status || 'N/A'})`);
        }
    }
}

// Test 3: Check frontend-backend data flow
console.log('\n🔄 Test 3: Data Flow Validation');

async function testDataFlow() {
    // Get jobs list
    const jobsResult = await testAPI('Jobs', 'admin_jobs_list', { token: TOKEN, status: 'all', days: 30 });
    
    if (jobsResult.status === 200) {
        console.log('  ✓ Jobs list loads successfully');
        
        const jobsReq = https.request({
            hostname: API_BASE,
            path: '/api/admin_jobs_list',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const job = json.jobs?.[0];
                    
                    if (job) {
                        console.log('  ✓ Sample job data:');
                        console.log(`    - job_id: ${job.job_id ? '✓' : '✗'}`);
                        console.log(`    - metadata: ${job.metadata ? '✓' : '✗'}`);
                        console.log(`    - items_json: ${job.metadata?.items_json ? '✓' : '✗'}`);
                        console.log(`    - purchasing_suggestions: ${job.purchasing_suggestions?.length || 0} items`);
                        console.log(`    - assigned_pro_name: ${job.assigned_pro_name || 'Unassigned'}`);
                    } else {
                        console.log('  ✗ No jobs returned');
                    }
                } catch (e) {
                    console.log('  ✗ Failed to parse jobs response');
                }
            });
        });
        
        jobsReq.write(JSON.stringify({ token: TOKEN, status: 'all', days: 30 }));
        jobsReq.end();
    } else {
        console.log('  ✗ Jobs list failed to load');
    }
}

// Run all tests
(async () => {
    await runAPITests();
    await testDataFlow();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ VALIDATION COMPLETE\n');
    console.log('Next steps:');
    console.log('1. Open dispatch.html in browser');
    console.log('2. Press F12 to open console');
    console.log('3. Look for any errors in console');
    console.log('4. Click a job to test modal loading');
    console.log('5. Check that photos, suggestions, and details all load\n');
})();
