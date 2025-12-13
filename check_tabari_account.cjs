const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

console.log('Supabase URL:', process.env.SUPABASE_URL ? 'Found' : 'Missing');
console.log('Anon Key:', process.env.SUPABASE_ANON_KEY ? 'Found' : 'Missing');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY // Use anon key since service role key not in .env
);

async function checkTabariAccount() {
  console.log('='.repeat(80));
  console.log('CHECKING TABARI ACCOUNT: tabari@tabariropt14.icloud.com');
  console.log('='.repeat(80));
  
  // 1. Find pro_id - try multiple email variations
  let pro = null;
  let proError = null;
  
  const emailsToTry = [
    'tabariroper14@icloud.com',
    'tabari@tabariropt14.icloud.com',
    'tabari@tabariropert14.icloud.com', 
    'tabar@tabariropt14.icloud.com',
    'dispatch@h2s.com'
  ];
  
  console.log('\nSearching for pro account...');
  for (const email of emailsToTry) {
    const result = await supabase
      .from('h2s_pros')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    
    if (result.data) {
      pro = result.data;
      console.log(`✅ Found account with email: ${email}`);
      break;
    }
  }
  
  if (!pro) {
    // List all pros to help identify the right one
    console.log('\n❌ Pro account not found. Listing all pros with "tabari" in name or email:');
    const { data: allPros } = await supabase
      .from('h2s_pros')
      .select('pro_id, name, email, phone')
      .or('name.ilike.%tabari%,email.ilike.%tabari%')
      .limit(10);
    
    if (allPros && allPros.length > 0) {
      allPros.forEach(p => {
        console.log(`  - ${p.name} (${p.email}) - ID: ${p.pro_id}`);
      });
    } else {
      console.log('  No pros found with "tabari" in name or email');
    }
    return;
  }
  
  console.log('\n✅ PRO ACCOUNT FOUND:');
  console.log('  Pro ID:', pro.pro_id);
  console.log('  Name:', pro.name);
  console.log('  Email:', pro.email);
  console.log('  Phone:', pro.phone);
  console.log('  Created:', pro.created_at);
  
  // 2. Find all assignments for this pro
  const { data: assignments, error: assignError } = await supabase
    .from('h2s_dispatch_job_assignments')
    .select('*')
    .eq('pro_id', pro.pro_id)
    .order('created_at', { ascending: false });
  
  if (assignError) {
    console.error('❌ Error fetching assignments:', assignError.message);
    return;
  }
  
  console.log(`\n📋 ASSIGNMENTS: ${assignments?.length || 0} total`);
  
  const byState = {};
  (assignments || []).forEach(a => {
    byState[a.state] = (byState[a.state] || 0) + 1;
  });
  
  console.log('  Breakdown by state:', byState);
  
  // 3. Show completed assignments in detail
  const completed = (assignments || []).filter(a => a.state === 'completed');
  
  if (completed.length > 0) {
    console.log(`\n✅ COMPLETED ASSIGNMENTS (${completed.length}):`);
    for (const assign of completed) {
      console.log(`\n  Assignment ID: ${assign.assign_id}`);
      console.log(`  Job ID: ${assign.job_id}`);
      console.log(`  State: ${assign.state}`);
      console.log(`  Accepted at: ${assign.accepted_at}`);
      console.log(`  Completed at: ${assign.completed_at}`);
      
      // Get job details
      const { data: job } = await supabase
        .from('h2s_dispatch_jobs')
        .select('*')
        .eq('job_id', assign.job_id)
        .single();
      
      if (job) {
        console.log(`  Job Status: ${job.status}`);
        console.log(`  Service: ${job.service_name || job.service_id}`);
        console.log(`  Customer: ${job.customer_name}`);
        console.log(`  Address: ${job.service_address}, ${job.service_city}`);
      }
      
      // Check if payout exists
      const { data: payout } = await supabase
        .from('h2s_payouts_ledger')
        .select('*')
        .eq('job_id', assign.job_id)
        .eq('pro_id', pro.pro_id)
        .maybeSingle();
      
      if (payout) {
        console.log(`  ✅ PAYOUT EXISTS:`);
        console.log(`     Amount: $${payout.amount}`);
        console.log(`     State: ${payout.state}`);
        console.log(`     Created: ${payout.created_at}`);
      } else {
        console.log(`  ❌ NO PAYOUT FOUND - THIS IS THE PROBLEM!`);
      }
    }
  }
  
  // 4. Check all payouts for this pro
  const { data: allPayouts, error: payoutError } = await supabase
    .from('h2s_payouts_ledger')
    .select('*')
    .eq('pro_id', pro.pro_id)
    .order('created_at', { ascending: false });
  
  if (payoutError) {
    console.error('❌ Error fetching payouts:', payoutError.message);
    return;
  }
  
  console.log(`\n💰 PAYOUTS IN LEDGER: ${allPayouts?.length || 0} total`);
  
  if (allPayouts && allPayouts.length > 0) {
    const byState = {};
    let totalAmount = 0;
    
    allPayouts.forEach(p => {
      byState[p.state] = (byState[p.state] || 0) + 1;
      totalAmount += parseFloat(p.amount || 0);
    });
    
    console.log('  Breakdown by state:', byState);
    console.log('  Total amount: $' + totalAmount.toFixed(2));
    
    console.log('\n  Recent payouts:');
    allPayouts.slice(0, 5).forEach(p => {
      console.log(`    Job ${p.job_id}: $${p.amount} (${p.state}) - Created: ${p.created_at}`);
    });
  }
  
  // 5. Check for artifacts (photos/signatures)
  if (completed.length > 0) {
    console.log('\n📸 CHECKING ARTIFACTS FOR COMPLETED JOBS:');
    for (const assign of completed) {
      const { data: artifacts } = await supabase
        .from('h2s_dispatch_job_artifacts')
        .select('*')
        .eq('job_id', assign.job_id)
        .eq('pro_id', pro.pro_id);
      
      const photos = (artifacts || []).filter(a => a.type === 'photo');
      const signatures = (artifacts || []).filter(a => a.type === 'signature');
      
      console.log(`\n  Job ${assign.job_id}:`);
      console.log(`    Photos: ${photos.length}`);
      console.log(`    Signatures: ${signatures.length}`);
    }
  }
  
  // 6. Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY:');
  console.log('='.repeat(80));
  console.log(`Total Assignments: ${assignments?.length || 0}`);
  console.log(`Completed Jobs: ${completed.length}`);
  console.log(`Payouts Created: ${allPayouts?.length || 0}`);
  console.log(`Missing Payouts: ${completed.length - (allPayouts?.length || 0)}`);
  
  if (completed.length > 0 && (!allPayouts || allPayouts.length === 0)) {
    console.log('\n⚠️  CRITICAL ISSUE: Completed jobs exist but NO payouts created!');
    console.log('    This means portal_mark_done API is not creating payout entries.');
  } else if (completed.length > allPayouts?.length) {
    console.log(`\n⚠️  WARNING: ${completed.length - allPayouts.length} completed jobs missing payouts`);
  } else if (completed.length === allPayouts?.length && completed.length > 0) {
    console.log('\n✅ All completed jobs have corresponding payouts!');
  }
}

checkTabariAccount().catch(console.error);
