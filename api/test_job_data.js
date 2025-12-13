import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // Use service role to bypass RLS
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get specific job
    const { data: jobs, error } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .eq('job_id', 'e5644e68-5aab-4b47-91fc-b42be2e89f0c')
      .limit(1);

    if (error) throw error;
    
    const job = jobs?.[0];
    if (!job) throw new Error('Job not found');

    const job = jobs?.[0];
    if (!job) throw new Error('Job not found');

    console.log('[test_job_data] Raw job from DB:', JSON.stringify(job, null, 2));
    console.log('[test_job_data] customer_name type:', typeof job.customer_name);
    console.log('[test_job_data] customer_name value:', job.customer_name);
    console.log('[test_job_data] metadata type:', typeof job.metadata);
    console.log('[test_job_data] metadata value:', JSON.stringify(job.metadata));
    console.log('[test_job_data] metadata keys:', Object.keys(job.metadata || {}));

    return res.status(200).json({
      ok: true,
      job: job,
      debug: {
        customer_name_type: typeof job.customer_name,
        customer_name_value: job.customer_name,
        customer_name_length: job.customer_name?.length,
        metadata_type: typeof job.metadata,
        metadata_is_null: job.metadata === null,
        metadata_is_empty_obj: JSON.stringify(job.metadata) === '{}',
        metadata_keys: Object.keys(job.metadata || {}),
        metadata_json: JSON.stringify(job.metadata)
      }
    });
  } catch (error) {
    console.error('[test_job_data] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
