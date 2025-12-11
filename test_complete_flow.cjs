#!/usr/bin/env node
/**
 * Test the complete flow after deployment
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const API_BASE = 'h2s-backend.vercel.app';

function makeAPIRequest(path, body) {
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
            error: responseData
          });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function testFlow() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧪 POST-DEPLOYMENT INTEGRATION TEST');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Test 1: Get Jaylan Lewis job from database
  console.log('1️⃣  TESTING DATABASE: Jaylan Lewis Job\n');
  const { data: job, error: jobError } = await supabase
    .from('h2s_dispatch_jobs')
    .select('*')
    .eq('customer_name', 'Jaylan Lewis')
    .single();
  
  if (jobError) {
    console.error('   ❌ Database query failed:', jobError.message);
    return;
  }
  
  console.log('   ✅ Job found in database');
  console.log('   Job ID:', job.job_id);
  console.log('   Service ID:', job.service_id || 'NULL');
  console.log('   Status:', job.status);
  
  if (job.metadata?.items_json) {
    console.log('\n   📦 metadata.items_json:');
    job.metadata.items_json.forEach((item, i) => {
      console.log(`      ${i + 1}. ${item.service_name} (${item.bundle_id})`);
      console.log(`         Qty: ${item.qty}, Price: ${item.line_total}`);
    });
  }
  
  // Test 2: Get portal session
  console.log('\n2️⃣  TESTING SESSION: Portal Login\n');
  const { data: sessions } = await supabase
    .from('h2s_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (!sessions || sessions.length === 0) {
    console.error('   ❌ No active sessions found');
    return;
  }
  
  const token = sessions[0].session_id;
  console.log('   ✅ Active session found');
  console.log('   Token:', token.substring(0, 20) + '...');
  
  // Test 3: Call portal_jobs API
  console.log('\n3️⃣  TESTING API: portal_jobs Endpoint\n');
  const apiResponse = await makeAPIRequest('portal_jobs', { token });
  
  console.log('   Status Code:', apiResponse.status);
  
  if (apiResponse.status !== 200) {
    console.error('   ❌ API call failed');
    console.error('   Error:', apiResponse.error);
    return;
  }
  
  console.log('   ✅ API call succeeded');
  console.log('   Response OK:', apiResponse.data.ok);
  
  if (apiResponse.data.offers && apiResponse.data.offers.length > 0) {
    console.log(`   Offers: ${apiResponse.data.offers.length} found`);
    
    // Find Jaylan's job
    const jaylanJob = apiResponse.data.offers.find(o => 
      o.customer_name === 'Jaylan Lewis' || o.job_id === job.job_id
    );
    
    if (jaylanJob) {
      console.log('\n   🎯 FOUND JAYLAN LEWIS JOB IN API RESPONSE:');
      console.log('   ─────────────────────────────────────────');
      console.log('   Job ID:', jaylanJob.job_id);
      console.log('   Customer:', jaylanJob.customer_name);
      console.log('   Address:', jaylanJob.address || jaylanJob.service_address);
      console.log('   Description:', jaylanJob.description);
      
      if (jaylanJob.line_items && jaylanJob.line_items.length > 0) {
        console.log('\n   📋 LINE ITEMS:');
        jaylanJob.line_items.forEach((line, i) => {
          console.log(`\n      Item ${i + 1}:`);
          console.log(`         Title: ${line.title}`);
          console.log(`         Service ID: ${line.service_id}`);
          console.log(`         Bundle ID: ${line.bundle_id || 'N/A'}`);
          console.log(`         Qty: ${line.qty}`);
          
          // Check if enrichment worked
          if (line.bundle_summary) {
            console.log(`         ✅ BUNDLE SUMMARY: ${line.bundle_summary}`);
          } else {
            console.log(`         ⚠️  NO BUNDLE SUMMARY`);
          }
          
          if (line.tech_details && Array.isArray(line.tech_details)) {
            console.log(`         ✅ TECH DETAILS (${line.tech_details.length} items):`);
            line.tech_details.forEach(detail => {
              console.log(`            • ${detail}`);
            });
          } else {
            console.log(`         ⚠️  NO TECH DETAILS`);
          }
        });
      } else {
        console.log('\n   ⚠️  NO LINE ITEMS in response');
      }
    } else {
      console.log('\n   ⚠️  Jaylan Lewis job not found in offers');
    }
  } else {
    console.log('   ⚠️  No offers returned');
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ TEST COMPLETE\n');
}

testFlow().catch(err => {
  console.error('\n💥 Test failed:', err);
  process.exit(1);
});
