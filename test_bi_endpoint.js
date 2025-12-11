import https from 'https';

const data = JSON.stringify({
  token: 'e5d4100f-fdbb-44c5-802c-0166d86ed1a8'  // Real session_id from database
});

const options = {
  hostname: 'h2s-backend-3noxj9sfl-tabari-ropers-projects-6f2e090b.vercel.app',
  path: '/api/admin_business_intelligence',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let responseData = '';
  
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    try {
      const json = JSON.parse(responseData);
      
      if (json.error) {
        console.log('\n❌ ERROR:', json.error);
        console.log('\nFull response:', JSON.stringify(json, null, 2));
        return;
      }
      
      console.log('\n✅ BUSINESS INTELLIGENCE METRICS:\n');
      console.log('📊 REVENUE:');
      console.log(`  Total Revenue: $${json.revenue?.total || 0}`);
      console.log(`  Total Cost: $${json.revenue?.cost || 0}`);
      console.log(`  Margin: ${json.revenue?.margin || 0}%`);
      console.log(`  Avg Job Value: $${json.revenue?.avg_job_value || 0}`);
      
      console.log('\n🏢 OPERATIONS:');
      console.log(`  Jobs Completed: ${json.operations?.jobs_completed || 0}`);
      console.log(`  Jobs Pending: ${json.operations?.jobs_pending || 0}`);
      console.log(`  Completion Rate: ${json.operations?.completion_rate || 0}%`);
      console.log(`  Bottlenecks: ${json.operations?.bottlenecks?.length || 0} jobs stuck`);
      
      console.log('\n🛠️ SERVICES (Top 5):');
      const services = json.services?.top_services || [];
      services.slice(0, 5).forEach(s => {
        console.log(`  ${s.name}: ${s.jobs} jobs, $${s.revenue}, ${s.margin}% margin`);
      });
      
      console.log('\n💰 PRICING TIERS:');
      console.log(`  BYO: ${json.pricing?.byo?.jobs || 0} jobs, $${json.pricing?.byo?.revenue || 0}, ${json.pricing?.byo?.margin || 0}% margin`);
      console.log(`  BASE: ${json.pricing?.base?.jobs || 0} jobs, $${json.pricing?.base?.revenue || 0}, ${json.pricing?.base?.margin || 0}% margin`);
      console.log(`  H2S: ${json.pricing?.h2s?.jobs || 0} jobs, $${json.pricing?.h2s?.revenue || 0}, ${json.pricing?.h2s?.margin || 0}% margin`);
      
      console.log('\n👥 WORKFORCE:');
      console.log(`  Total Pros: ${json.workforce?.total_pros || 0}`);
      console.log(`  Active Pros: ${json.workforce?.active_pros || 0}`);
      console.log(`  Utilization: ${json.workforce?.utilization_rate || 0}%`);
      
      console.log('\n📈 GROWTH:');
      console.log(`  MoM Growth: ${json.growth?.mom_growth || 0}%`);
      console.log(`  Unique Customers: ${json.growth?.unique_customers || 0}`);
      console.log(`  Repeat Rate: ${json.growth?.repeat_rate || 0}%`);
      
    } catch (err) {
      console.error('Failed to parse JSON:', err.message);
      console.log('Response:', responseData);
    }
  });
});

req.on('error', (error) => {
  console.error('Request failed:', error);
});

req.write(data);
req.end();
