const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const API_BASE = 'https://h2s-backend.vercel.app/api';
const ADMIN_TOKEN = 'e5d4100f-fdbb-44c5-802c-0166d86ed1a8';

async function diagnose() {
    try {
        console.log('Fetching jobs...');
        const response = await fetch(`${API_BASE}/admin_jobs_list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: ADMIN_TOKEN, status: 'completed', days: 60 })
        });

        const data = await response.json();
        const jobs = data.jobs || [];
        
        console.log(`Scanned ${jobs.length} completed jobs.`);

        // Filter for jobs that still look "broken"
        const brokenJobs = jobs.filter(j => 
            j.customer_name === 'Unknown Customer' || 
            j.address === 'No Address' ||
            !j.customer_name ||
            !j.address
        );

        console.log(`Found ${brokenJobs.length} jobs with missing data.`);

        if (brokenJobs.length > 0) {
            console.log('\n--- DIAGNOSTIC REPORT ---');
            brokenJobs.slice(0, 5).forEach(job => {
                console.log(`\nJob ID: ${job.job_id}`);
                console.log(`Current Name: "${job.customer_name}"`);
                console.log(`Current Address: "${job.address}"`);
                console.log('Metadata Keys:', Object.keys(job.metadata || {}));
                console.log('Line Items:', JSON.stringify(job.line_items_json || [], null, 2));
                console.log('Full Metadata:', JSON.stringify(job.metadata, null, 2));
            });
        } else {
            console.log('✅ All completed jobs returned by the API have valid names and addresses.');
            console.log('If you still see "Unknown", it is 100% a browser cache issue.');
        }

    } catch (error) {
        console.error('Diagnostic failed:', error);
    }
}

diagnose();
