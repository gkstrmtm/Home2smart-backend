const https = require('https');

const API_BASE = 'h2s-backend-46ub86u5v-tabari-ropers-projects-6f2e090b.vercel.app';
const ADMIN_TOKEN = 'e5d4100f-fdbb-44c5-802c-0166d86ed1a8';

function makeRequest(path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request({
            hostname: API_BASE,
            path: `/api/${path}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
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

async function checkDataStructure() {
    console.log('\n🔍 CHECKING DATA STRUCTURE\n');
    
    const jobsRes = await makeRequest('admin_jobs_list', { 
        token: ADMIN_TOKEN, 
        status: 'all', 
        days: 90 
    });
    
    if (jobsRes.data.jobs && jobsRes.data.jobs.length > 0) {
        const job = jobsRes.data.jobs[0];
        console.log('Sample Job Structure:');
        console.log('  job_id:', job.job_id);
        console.log('  status:', job.status);
        console.log('  assigned_pro_id:', job.assigned_pro_id);
        console.log('  assigned_pro_name:', job.assigned_pro_name);
        console.log('  line_items_json:', job.line_items_json ? 'Present' : 'Missing');
        console.log('  metadata.estimated_payout:', job.metadata?.estimated_payout);
        console.log('  metadata.customer_total:', job.metadata?.customer_total);
        console.log('\nAll jobs summary:');
        const proPayouts = {};
        jobsRes.data.jobs.forEach(j => {
            if (j.assigned_pro_id && (j.status === 'completed' || j.status === 'accepted')) {
                const proName = j.assigned_pro_name || j.assigned_pro_id;
                if (!proPayouts[proName]) {
                    proPayouts[proName] = { jobs: 0, totalPayout: 0 };
                }
                proPayouts[proName].jobs++;
                proPayouts[proName].totalPayout += (j.metadata?.estimated_payout || 0);
            }
        });
        
        console.log('\nCalculated from Jobs (metadata.estimated_payout):');
        Object.entries(proPayouts)
            .sort((a, b) => b[1].totalPayout - a[1].totalPayout)
            .forEach(([name, stats]) => {
                console.log(`  ${name}: ${stats.jobs} jobs, $${stats.totalPayout.toFixed(2)}`);
            });
    }
}

checkDataStructure().catch(console.error);
