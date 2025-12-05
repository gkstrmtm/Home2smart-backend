
require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyJobData() {
    console.log('🔍 Verifying Job Data Integrity...');

    // Count total jobs with order_id
    const { count, error: countError } = await supabase
        .from('h2s_dispatch_jobs')
        .select('*', { count: 'exact', head: true })
        .not('metadata->order_id', 'is', null);
    
    console.log(`Total jobs with order_id: ${count}`);

    // Check for broken ones
    const { data: brokenJobs, error: brokenError } = await supabase
        .from('h2s_dispatch_jobs')
        .select('job_id, metadata')
        .not('metadata->order_id', 'is', null)
        .is('customer_id', null);

    if (brokenJobs && brokenJobs.length > 0) {
        console.log(`❌ Found ${brokenJobs.length} jobs with order_id but NO customer_id!`);
        console.log('Example:', brokenJobs[0]);
    } else {
        console.log('✅ No jobs found with order_id but missing customer_id.');
    }
    
    // Check for jobs with customer_id but missing phone in customer profile
    // This is harder to do in one query without a join, so we'll sample again
}

verifyJobData();
