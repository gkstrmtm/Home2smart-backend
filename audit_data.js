// Data Audit - Check what exists in database
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function auditData() {
  console.log('=== DATABASE AUDIT ===\n');
  
  // 1. Check Jobs
  const { data: jobs, error: jobsErr } = await supabase
    .from('h2s_dispatch_jobs')
    .select('*')
    .limit(5);
  
  console.log('📋 JOBS TABLE:');
  console.log(`  Total sample: ${jobs?.length || 0}`);
  if (jobs && jobs.length > 0) {
    const job = jobs[0];
    console.log('  Sample job structure:', Object.keys(job));
    console.log('  Job status:', job.status);
    console.log('  Has metadata:', !!job.metadata);
    console.log('  Has line_items_json:', !!job.line_items_json);
    
    if (job.metadata) {
      console.log('  Metadata keys:', Object.keys(job.metadata));
      console.log('  Full metadata:', JSON.stringify(job.metadata, null, 2));
      console.log('  Has estimated_payout:', !!job.metadata.estimated_payout);
      console.log('  Has items_json:', !!job.metadata.items_json);
    }
    
    if (job.line_items_json) {
      console.log('  line_items_json sample:', JSON.stringify(job.line_items_json, null, 2));
    }
    
    // Calculate potential revenue
    let totalRevenue = 0;
    let totalPayout = 0;
    jobs.forEach(j => {
      if (j.metadata?.items_json) {
        j.metadata.items_json.forEach(item => {
          totalRevenue += item.line_total || 0;
        });
      }
      totalPayout += j.metadata?.estimated_payout || 0;
    });
    console.log(`  Potential revenue (5 jobs): $${totalRevenue}`);
    console.log(`  Potential payouts (5 jobs): $${totalPayout}`);
    console.log(`  Potential margin: ${totalRevenue > 0 ? ((totalRevenue - totalPayout) / totalRevenue * 100).toFixed(1) : 0}%\n`);
  }
  
  // 2. Check Payouts Ledger
  const { data: payouts, error: payErr } = await supabase
    .from('h2s_payouts_ledger')
    .select('*')
    .limit(5);
  
  console.log('💰 PAYOUTS LEDGER:');
  console.log(`  Total entries: ${payouts?.length || 0}`);
  if (payouts && payouts.length > 0) {
    console.log('  Sample payout structure:', Object.keys(payouts[0]));
    const totals = payouts.reduce((acc, p) => {
      const state = p.state || 'unknown';
      acc[state] = (acc[state] || 0) + (Number(p.amount) || 0);
      return acc;
    }, {});
    console.log('  Totals by state:', totals);
  } else {
    console.log('  ⚠️  EMPTY - Needs population from jobs\n');
  }
  
  // 3. Check Admin Sessions
  const { data: sessions } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('*')
    .gte('expires_at', new Date().toISOString())
    .limit(3);
  
  console.log('\n🔐 ADMIN SESSIONS:');
  console.log(`  Active sessions: ${sessions?.length || 0}`);
  if (sessions && sessions.length > 0) {
    console.log(`  Sample session:`, JSON.stringify(sessions[0], null, 2));
    console.log(`  Has session_id field: ${!!sessions[0].session_id}`);
    console.log(`  Has token field: ${!!sessions[0].token}`);
  }
  console.log('');
  
  // 4. Check Pros
  const { data: pros } = await supabase
    .from('h2s_dispatch_pros')
    .select('*')
    .limit(5);
  
  console.log('👷 PROS TABLE:');
  console.log(`  Total pros: ${pros?.length || 0}`);
  if (pros && pros.length > 0) {
    console.log('  Sample pro structure:', Object.keys(pros[0]));
  } else {
    console.log('  ⚠️  EMPTY - No technicians in system\n');
  }
  
  // 5. Analyze Services
  const { data: allJobs } = await supabase
    .from('h2s_dispatch_jobs')
    .select('service_name, metadata, status');
  
  console.log('🛠️  SERVICE ANALYSIS:');
  if (allJobs) {
    const serviceMap = {};
    allJobs.forEach(job => {
      const name = job.service_name || 'unknown';
      if (!serviceMap[name]) {
        serviceMap[name] = { count: 0, revenue: 0, completed: 0 };
      }
      serviceMap[name].count++;
      if (job.status === 'completed') serviceMap[name].completed++;
      
      if (job.metadata?.items_json) {
        job.metadata.items_json.forEach(item => {
          serviceMap[name].revenue += item.line_total || 0;
        });
      }
    });
    
    console.log('  Services breakdown:');
    Object.entries(serviceMap).forEach(([name, data]) => {
      console.log(`    ${name}: ${data.count} jobs, $${data.revenue}, ${data.completed} completed`);
    });
  }
  console.log('');
  
  console.log('=== RECOMMENDATIONS ===');
  console.log('1. Populate h2s_payouts_ledger from jobs.metadata.estimated_payout');
  console.log('2. Calculate revenue from jobs.metadata.items_json');
  console.log('3. Extract pricing tiers from line items metadata');
  console.log('4. Link pros to jobs for workforce metrics');
  console.log('');
}

auditData().catch(console.error);
