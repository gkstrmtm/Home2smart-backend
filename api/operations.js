import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Diagnostic probe for portal_jobs issues
    const diagnostics = {
      timestamp: new Date().toISOString(),
      env_check: {
        has_supabase_url: !!process.env.SUPABASE_URL,
        has_supabase_key: !!process.env.SUPABASE_ANON_KEY,
        supabase_url: process.env.SUPABASE_URL?.substring(0, 30) + '...'
      },
      tests: []
    };

    // Test 1: Can we connect to Supabase?
    try {
      const { data: testQuery, error: testError } = await supabase
        .from('h2s_sessions')
        .select('session_id')
        .limit(1);
      
      diagnostics.tests.push({
        name: 'supabase_connection',
        status: testError ? 'FAIL' : 'PASS',
        error: testError?.message,
        result: testQuery ? 'Connected' : 'No data'
      });
    } catch (err) {
      diagnostics.tests.push({
        name: 'supabase_connection',
        status: 'ERROR',
        error: err.message
      });
    }

    // Test 2: Check if h2s_jobs table exists and has data
    try {
      const { data: jobs, error: jobsError } = await supabase
        .from('h2s_jobs')
        .select('job_id, pro_id, status, created_at')
        .limit(10);
      
      diagnostics.tests.push({
        name: 'h2s_jobs_table',
        status: jobsError ? 'FAIL' : 'PASS',
        error: jobsError?.message,
        job_count: jobs?.length || 0,
        sample_jobs: jobs?.map(j => ({
          job_id: j.job_id,
          pro_id: j.pro_id,
          status: j.status
        }))
      });
    } catch (err) {
      diagnostics.tests.push({
        name: 'h2s_jobs_table',
        status: 'ERROR',
        error: err.message
      });
    }

    // Test 3: Check sessions table
    try {
      const { data: sessions, error: sessError } = await supabase
        .from('h2s_sessions')
        .select('session_id, pro_id, expires_at')
        .limit(5);
      
      diagnostics.tests.push({
        name: 'h2s_sessions_table',
        status: sessError ? 'FAIL' : 'PASS',
        error: sessError?.message,
        session_count: sessions?.length || 0,
        sample_sessions: sessions?.map(s => ({
          session_id: s.session_id?.substring(0, 15) + '...',
          pro_id: s.pro_id,
          expired: new Date(s.expires_at) < new Date()
        }))
      });
    } catch (err) {
      diagnostics.tests.push({
        name: 'h2s_sessions_table',
        status: 'ERROR',
        error: err.message
      });
    }

    // Test 4: Get column info for h2s_jobs
    try {
      const { data: sampleJob, error: structError } = await supabase
        .from('h2s_jobs')
        .select('*')
        .limit(1)
        .single();
      
      diagnostics.tests.push({
        name: 'h2s_jobs_structure',
        status: structError ? 'FAIL' : 'PASS',
        error: structError?.message,
        columns: sampleJob ? Object.keys(sampleJob) : []
      });
    } catch (err) {
      diagnostics.tests.push({
        name: 'h2s_jobs_structure',
        status: 'ERROR',
        error: err.message
      });
    }

    // Test 5: Check h2s_job_assignments table structure
    try {
      const { data: assignments, error } = await supabase
        .from('h2s_job_assignments')
        .select('*')
        .limit(5);
      
      diagnostics.tests.push({
        name: 'h2s_job_assignments',
        status: error ? 'FAIL' : 'PASS',
        error: error?.message,
        count: assignments?.length || 0,
        columns: assignments && assignments.length > 0 ? Object.keys(assignments[0]) : 'EMPTY - inserting test row',
        sample_data: assignments
      });
      
      // If empty, try to get columns by describing the table
      if (!assignments || assignments.length === 0) {
        // Try inserting and immediately deleting to see what columns exist
        const testAssignment = {
          job_id: 'test_probe',
          pro_id: 'test_probe'
        };
        
        const { data: insertData, error: insertError } = await supabase
          .from('h2s_job_assignments')
          .insert([testAssignment])
          .select();
        
        diagnostics.tests.push({
          name: 'h2s_job_assignments_test_insert',
          status: insertError ? 'FAIL' : 'PASS',
          error: insertError?.message,
          inserted_columns: insertData && insertData.length > 0 ? Object.keys(insertData[0]) : []
        });
        
        // Clean up test row
        if (insertData && insertData.length > 0) {
          await supabase
            .from('h2s_job_assignments')
            .delete()
            .eq('job_id', 'test_probe');
        }
      }
    } catch (err) {
      diagnostics.tests.push({
        name: 'h2s_job_assignments',
        status: 'ERROR',
        error: err.message
      });
    }

    // Test 6: Get sample job to see all data
    try {
      const { data: sampleJob, error } = await supabase
        .from('h2s_jobs')
        .select('*')
        .limit(1)
        .single();
      
      diagnostics.tests.push({
        name: 'sample_job_data',
        status: error ? 'FAIL' : 'PASS',
        error: error?.message,
        sample: sampleJob
      });
    } catch (err) {
      diagnostics.tests.push({
        name: 'sample_job_data',
        status: 'ERROR',
        error: err.message
      });
    }

    return res.json({
      ok: true,
      message: 'Diagnostic probe complete',
      diagnostics
    });

  } catch (error) {
    console.error('Operations probe error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Probe failed',
      details: error.message,
      stack: error.stack
    });
  }
}
