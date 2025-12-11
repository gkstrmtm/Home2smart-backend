const https = require('https');

const API_BASE = 'h2s-backend-6hvxj0mez-tabari-ropers-projects-6f2e090b.vercel.app';
const TOKEN = 'e5d4100f-fdbb-44c5-802c-0166d86ed1a8';

console.log('🔍 Testing all API endpoints...\n');

async function testEndpoint(name, path, body) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const data = JSON.stringify(body);
        
        const options = {
            hostname: API_BASE,
            path: `/api/${path}`,
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
                const duration = Date.now() - startTime;
                try {
                    const json = JSON.parse(responseData);
                    resolve({
                        name,
                        status: res.statusCode,
                        duration,
                        ok: json.ok,
                        error: json.error,
                        dataSize: JSON.stringify(json).length
                    });
                } catch (e) {
                    resolve({
                        name,
                        status: res.statusCode,
                        duration,
                        error: 'Parse error',
                        raw: responseData.substring(0, 200)
                    });
                }
            });
        });

        req.on('error', (error) => {
            resolve({
                name,
                error: error.message,
                duration: Date.now() - startTime
            });
        });

        req.write(data);
        req.end();
    });
}

async function runTests() {
    const tests = [
        {
            name: 'Business Intelligence',
            path: 'admin_business_intelligence',
            body: { token: TOKEN }
        },
        {
            name: 'Jobs List',
            path: 'admin_jobs_list',
            body: { token: TOKEN, status: 'all', days: 30 }
        },
        {
            name: 'Get Artifacts',
            path: 'portal_get_artifacts',
            body: { token: TOKEN, job_id: '1c2cf924-471a-47cb-a9b4-f35d98eb75b1', type: 'photo' }
        }
    ];

    for (const test of tests) {
        const result = await testEndpoint(test.name, test.path, test.body);
        
        console.log(`${test.name}:`);
        console.log(`  Status: ${result.status || 'ERROR'}`);
        console.log(`  Duration: ${result.duration}ms`);
        console.log(`  OK: ${result.ok !== undefined ? result.ok : 'N/A'}`);
        if (result.error) {
            console.log(`  Error: ${result.error}`);
        }
        if (result.dataSize) {
            console.log(`  Data Size: ${Math.round(result.dataSize / 1024)}KB`);
        }
        if (result.raw) {
            console.log(`  Raw Response: ${result.raw}`);
        }
        console.log('');
    }
}

runTests();
