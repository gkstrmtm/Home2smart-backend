import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const API_URL = 'https://h2s-backend.vercel.app/api/schedule-appointment';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runProbe() {
  console.log('🚀 Starting Booking Probe...');

  // 1. Create a Test Order
  const testId = crypto.randomUUID();
  const testOrderId = `PROBE-${testId.substring(0, 8)}`;
  const testSessionId = `sess_${testId}`;
  
  console.log(`📝 Creating test order: ${testOrderId}`);

  const { data: order, error: insertError } = await supabase
    .from('h2s_orders')
    .insert({
      id: testId,
      order_id: testOrderId,
      session_id: testSessionId,
      customer_email: 'probe_test@home2smart.com',
      customer_name: 'Probe Test User',
      customer_phone: '555-0199',
      service_name: 'Probe Test Service',
      subtotal: 1.00,
      total: 1.00,
      status: 'paid',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (insertError) {
    console.error('❌ Failed to insert test order:', insertError);
    process.exit(1);
  }
  console.log('✅ Test order created.');

  // 2. Call the API Endpoint
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];
  const timeStr = '10:00 AM - 12:00 PM';
  
  // Construct ISO times for dispatch job
  const startIso = `${dateStr}T10:00:00`;
  const endIso = `${dateStr}T12:00:00`;

  const payload = {
    order_id: testSessionId, // Using session_id as the lookup key
    delivery_date: dateStr,
    delivery_time: timeStr,
    start_iso: new Date(startIso).toISOString(),
    end_iso: new Date(endIso).toISOString(),
    timezone: 'America/New_York'
  };

  console.log(`📡 Sending payload to ${API_URL}...`, payload);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    
    if (!res.ok) {
      console.error('❌ API Request Failed:', res.status, data);
    } else {
      console.log('✅ API Request Successful:', data);
    }

  } catch (err) {
    console.error('❌ Network Error:', err);
  }

  // 3. Verify Dispatch Job Creation
  console.log('🔍 Verifying h2s_dispatch_jobs...');
  
  // Give it a moment for async processing if any (though the API awaits it)
  await new Promise(r => setTimeout(r, 1000));

  const { data: job, error: jobError } = await supabase
    .from('h2s_dispatch_jobs')
    .select('*')
    .eq('order_id', testSessionId) // The API uses the lookup ID as order_id in the job? 
    // Wait, schedule-appointment.js says: order_id: order_id (which is the input param)
    // But let's check if it uses the order's UUID or the input string.
    // Code: order_id: order_id (input param)
    .single();

  if (jobError && jobError.code !== 'PGRST116') {
    console.error('❌ Error checking dispatch job:', jobError);
  } else if (job) {
    console.log('✅ Dispatch Job Found!');
    console.log('   Job ID:', job.job_id);
    console.log('   Status:', job.status);
    console.log('   Start:', job.start_iso);
    console.log('   End:', job.end_iso);
    
    // Verify data congruence
    if (job.start_iso === payload.start_iso && job.end_iso === payload.end_iso) {
      console.log('✅ Data Congruence Verified: Dates match.');
    } else {
      console.warn('⚠️ Data Mismatch: Dates do not match payload.');
    }
  } else {
    console.error('❌ Dispatch Job NOT Found.');
  }

  // 4. Cleanup
  console.log('🧹 Cleaning up test data...');
  await supabase.from('h2s_orders').delete().eq('id', testId);
  if (job) {
    await supabase.from('h2s_dispatch_jobs').delete().eq('job_id', job.job_id);
  }
  console.log('✅ Cleanup complete.');
}

runProbe();
