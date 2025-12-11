require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function investigateJob() {
  console.log('🔍 Investigating Jaylan Lewis job...\n');
  
  // Get the job
  const { data: job, error } = await supabase
    .from('h2s_dispatch_jobs')
    .select('*')
    .eq('customer_name', 'Jaylan Lewis')
    .single();
    
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log('📋 JOB BASICS:');
  console.log('  Job ID:', job.job_id);
  console.log('  Service ID:', job.service_id);
  console.log('  Service Name:', job.service_name);
  console.log('  Notes:', job.notes_from_customer);
  console.log('  Resources Needed:', job.resources_needed);
  
  console.log('\n💾 METADATA:');
  if (job.metadata) {
    console.log('  Source:', job.metadata.source);
    console.log('  Order ID:', job.metadata.order_id);
    console.log('  Estimated Payout:', job.metadata.estimated_payout);
    
    if (job.metadata.items_json) {
      console.log('\n📦 ITEMS_JSON (Raw Bundle Data):');
      console.log(JSON.stringify(job.metadata.items_json, null, 2));
      
      console.log('\n🔍 DETAILED BREAKDOWN:');
      job.metadata.items_json.forEach((item, i) => {
        console.log(`\n  Item ${i + 1}:`);
        console.log('    Service Name:', item.service_name);
        console.log('    Bundle ID:', item.bundle_id);
        console.log('    Type:', item.type);
        console.log('    Qty:', item.qty);
        console.log('    Price:', item.line_total / 100, 'dollars');
      });
    }
  }
  
  // Now check if there's bundle definition data
  console.log('\n\n🎯 CHECKING BUNDLE DEFINITIONS...');
  
  const { data: bundles, error: bundleError } = await supabase
    .from('h2s_dispatch_bundles')
    .select('*')
    .in('bundle_id', ['cam_basic', 'cam_premium']);
    
  if (bundleError) {
    console.log('❌ No bundle definitions table or error:', bundleError.message);
  } else if (bundles && bundles.length > 0) {
    console.log('\n📚 BUNDLE DEFINITIONS FOUND:');
    bundles.forEach(bundle => {
      console.log(`\n  ${bundle.bundle_id}:`);
      console.log('    Name:', bundle.name);
      console.log('    Description:', bundle.description);
      console.log('    Details:', bundle.details);
      console.log('    Resources:', bundle.resources_needed);
    });
  } else {
    console.log('⚠️  No bundle definitions found in database');
    console.log('💡 Solution: We need to either:');
    console.log('   1. Create bundle definitions in the database');
    console.log('   2. Hard-code bundle details in the frontend');
  }
}

investigateJob().catch(console.error);
