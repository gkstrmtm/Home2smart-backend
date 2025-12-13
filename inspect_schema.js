import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function inspect() {
    console.log(' Inspecting Table Structures...');

    console.log('\n--- h2s_dispatch_jobs Columns ---');
    const { data: jobs, error: jobsErr } = await supabase
        .from('h2s_dispatch_jobs')
        .select('*')
        .limit(1);

    if (jobsErr) console.error('Error:', jobsErr);
    else if (jobs.length > 0) console.log('Columns:', Object.keys(jobs[0]));
    else console.log('Table empty, cannot infer columns.');

    console.log('\n--- h2s_orders Sample ---');
    const { data: orders } = await supabase
        .from('h2s_orders')
        .select('*')
        .limit(1);
    if (orders && orders.length > 0) console.log('Sample Order:', orders[0]);
}

inspect();
