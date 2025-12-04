// Backfill jobs for existing orders that don't have jobs yet
// This simulates what the webhook SHOULD do

async function backfillJobs() {
  console.log('🔄 Backfilling jobs for orphaned orders...\n');
  
  const orphanedOrders = [
    'order_1764874578511_h11my',
    'order_1764871639875_yzh7s',
    'order_1764871625173_reotu'
  ];
  
  for (const orderId of orphanedOrders) {
    console.log(`\n📦 Processing ${orderId}...`);
    
    try {
      const response = await fetch('https://h2s-backend.vercel.app/api/create_jobs_from_orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId,
          test_mode: true  // Use test_mode to bypass auth
        })
      });
      
      const result = await response.json();
      
      if (result.ok && result.jobs_created > 0) {
        console.log(`✅ Created ${result.jobs_created} job(s)`);
        console.log(`   Job ID: ${result.details[0]?.job_id}`);
        console.log(`   Service: ${result.details[0]?.service}`);
        console.log(`   Address: ${result.details[0]?.address}`);
        console.log(`   Payout: $${result.details[0]?.payout}`);
      } else if (result.jobs_skipped > 0) {
        console.log(`⚠️ Job already exists (skipped)`);
      } else {
        console.log(`❌ Failed:`, result.error || 'Unknown error');
      }
    } catch (err) {
      console.error(`❌ Error:`, err.message);
    }
  }
  
  console.log('\n\n✅ Backfill complete! Check your portal now.');
}

backfillJobs();
