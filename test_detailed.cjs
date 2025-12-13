const https = require('https');

function makeRequest(hostname, path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request({
            hostname,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length,
                'Cache-Control': 'no-cache'
            }
        }, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(responseData)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: responseData
                    });
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function testDetailed() {
    const API = 'h2s-backend-74reb1tn4-tabari-ropers-projects-6f2e090b.vercel.app';
    const TOKEN = 'e5d4100f-fdbb-44c5-802c-0166d86ed1a8';
    
    console.log('\n🔍 DETAILED TOP PERFORMERS TEST\n');
    
    const res = await makeRequest(API, '/api/admin_business_intelligence', { token: TOKEN });
    
    console.log('Response Status:', res.status);
    console.log('Response OK:', res.data.ok);
    console.log('\nWorkforce Data:');
    console.log('  Total Pros:', res.data.workforce?.total_pros);
    console.log('  Active Pros:', res.data.workforce?.active_pros);
    console.log('  Top Performers Count:', res.data.workforce?.top_performers?.length);
    
    if (res.data.workforce?.top_performers && res.data.workforce.top_performers.length > 0) {
        console.log('\n✅ TOP PERFORMERS FOUND:');
        res.data.workforce.top_performers.forEach((p, i) => {
            console.log(`  ${i+1}. ${p.name}: ${p.jobs} jobs, $${p.earnings}, avg $${p.avg_per_job}/job`);
        });
    } else {
        console.log('\n❌ NO TOP PERFORMERS - Checking other data...');
        console.log('\nRevenue:');
        console.log('  Total:', res.data.revenue?.total);
        console.log('  Cost:', res.data.revenue?.cost);
        console.log('\nOperations:');
        console.log('  Completed Jobs:', res.data.operations?.jobs_completed);
        console.log('  Pending Jobs:', res.data.operations?.jobs_pending);
    }
}

testDetailed().catch(console.error);
