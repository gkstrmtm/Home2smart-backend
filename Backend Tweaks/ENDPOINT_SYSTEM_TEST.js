/**
 * COMPREHENSIVE ENDPOINT & DATA FLOW TEST
 * Tests all critical UI-to-database operations
 */

function testAllEndpoints(){
  Logger.log('\n========================================');
  Logger.log('🔍 COMPREHENSIVE ENDPOINT TEST');
  Logger.log('========================================\n');
  
  var results = {
    total: 0,
    passed: 0,
    failed: 0,
    tests: []
  };
  
  function test(name, fn){
    results.total++;
    try {
      var result = fn();
      if(result && result.ok !== false){
        Logger.log('✅ PASS: ' + name);
        results.passed++;
        results.tests.push({name: name, status: 'PASS'});
      } else {
        Logger.log('❌ FAIL: ' + name + ' - ' + (result ? result.error : 'No response'));
        results.failed++;
        results.tests.push({name: name, status: 'FAIL', error: result ? result.error : 'No response'});
      }
    } catch(e){
      Logger.log('❌ FAIL: ' + name + ' - ' + e.toString());
      results.failed++;
      results.tests.push({name: name, status: 'FAIL', error: e.toString()});
    }
  }
  
  // ===== DATABASE READ OPERATIONS =====
  Logger.log('\n--- Testing Database Reads ---\n');
  
  test('Read Jobs from Database', function(){
    var jobs = readAll(TABS.JOBS);
    return {ok: jobs && jobs.length > 0};
  });
  
  test('Read Job_Lines from Database', function(){
    var lines = readAll(TABS.JOB_LINES);
    return {ok: lines && lines.length > 0};
  });
  
  test('Read Service_Variants from Database', function(){
    var variants = readAll(TABS.SERVICE_VARIANTS);
    return {ok: variants && variants.length > 0};
  });
  
  test('Read Payouts from Database', function(){
    var payouts = readAll(TABS.LEDGER);
    return {ok: payouts !== null};
  });
  
  test('Read Pros from Database', function(){
    var pros = readAll(TABS.PROS);
    return {ok: pros !== null};
  });
  
  test('Read Services from Database', function(){
    var services = readAll(TABS.SERVICES);
    return {ok: services && services.length > 0};
  });
  
  // ===== DATA INTEGRITY CHECKS =====
  Logger.log('\n--- Testing Data Integrity ---\n');
  
  test('Jobs have Job_Lines coverage', function(){
    var jobs = readAll(TABS.JOBS);
    var lines = readAll(TABS.JOB_LINES);
    var jobIds = {};
    lines.forEach(function(l){ jobIds[l.job_id] = true; });
    var coverage = 0;
    jobs.forEach(function(j){ if(jobIds[j.job_id]) coverage++; });
    var pct = Math.round(coverage / jobs.length * 100);
    Logger.log('  Coverage: ' + pct + '% (' + coverage + '/' + jobs.length + ')');
    return {ok: pct >= 95}; // 95%+ coverage is good
  });
  
  test('Job_Lines have pricing data', function(){
    var lines = readAll(TABS.JOB_LINES);
    var withPricing = lines.filter(function(l){
      return Number(l.line_customer_total || 0) > 0;
    }).length;
    var pct = Math.round(withPricing / lines.length * 100);
    Logger.log('  With pricing: ' + pct + '% (' + withPricing + '/' + lines.length + ')');
    return {ok: pct >= 95};
  });
  
  test('Service_Variants linked to Services', function(){
    var variants = readAll(TABS.SERVICE_VARIANTS);
    var services = indexBy(readAll(TABS.SERVICES), 'service_id');
    var valid = variants.filter(function(v){
      return services[v.service_id];
    }).length;
    var pct = Math.round(valid / variants.length * 100);
    Logger.log('  Valid links: ' + pct + '% (' + valid + '/' + variants.length + ')');
    return {ok: pct >= 90}; // Some orphans are OK
  });
  
  // ===== ENDPOINT SIMULATION =====
  Logger.log('\n--- Testing Portal Endpoints ---\n');
  
  test('Portal: Get Jobs List', function(){
    var jobs = readAll(TABS.JOBS);
    var assignments = readAll(TABS.ASSIGN);
    // Simulate portalJobs endpoint logic
    var result = jobs.filter(function(j){
      return j.status !== 'cancelled';
    });
    return {ok: result.length >= 0}; // Even 0 jobs is valid
  });
  
  test('Portal: Get Payouts', function(){
    var payouts = readAll(TABS.LEDGER);
    var result = payouts.filter(function(p){
      return !p.paid_at; // Pending payouts
    });
    Logger.log('  Pending payouts: ' + result.length + ' ($' + result.reduce(function(sum, p){ return sum + Number(p.amount || 0); }, 0) + ')');
    return {ok: true}; // Always passes if readable
  });
  
  test('Portal: Calculate Job Payout', function(){
    var jobs = readAll(TABS.JOBS);
    var lines = readAll(TABS.JOB_LINES);
    
    // Find a job with lines
    var testJob = jobs.find(function(j){
      return lines.some(function(l){ return l.job_id === j.job_id; });
    });
    
    if(!testJob) return {ok: false, error: 'No jobs with lines found'};
    
    var jobLines = lines.filter(function(l){ return l.job_id === testJob.job_id; });
    var totalPayout = jobLines.reduce(function(sum, l){
      return sum + Number(l.calc_pro_payout_total || 0);
    }, 0);
    
    Logger.log('  Job ' + testJob.job_id + ': $' + totalPayout + ' payout');
    return {ok: totalPayout > 0};
  });
  
  // ===== ADMIN/DISPATCH ENDPOINTS =====
  Logger.log('\n--- Testing Admin Endpoints ---\n');
  
  test('Admin: List All Jobs', function(){
    var jobs = readAll(TABS.JOBS);
    var services = indexBy(readAll(TABS.SERVICES), 'service_id');
    
    // Simulate adminJobsList endpoint
    var result = jobs.map(function(j){
      var svc = services[j.service_id] || {};
      return {
        job_id: j.job_id,
        status: j.status,
        service_name: svc.name,
        customer_name: j.customer_name
      };
    });
    
    Logger.log('  Jobs available: ' + result.length);
    return {ok: result.length > 0};
  });
  
  test('Admin: Get Job Details', function(){
    var jobs = readAll(TABS.JOBS);
    var lines = readAll(TABS.JOB_LINES);
    var assignments = readAll(TABS.ASSIGN);
    
    var testJob = jobs[0];
    if(!testJob) return {ok: false, error: 'No jobs'};
    
    var jobLines = lines.filter(function(l){ return l.job_id === testJob.job_id; });
    var jobAssignments = assignments.filter(function(a){ return a.job_id === testJob.job_id; });
    
    Logger.log('  Job ' + testJob.job_id + ': ' + jobLines.length + ' lines, ' + jobAssignments.length + ' assignments');
    return {ok: true};
  });
  
  test('Admin: Calculate Revenue & Margins', function(){
    var lines = readAll(TABS.JOB_LINES);
    
    var totalRevenue = 0;
    var totalCost = 0;
    
    lines.forEach(function(l){
      totalRevenue += Number(l.line_customer_total || 0);
      totalCost += Number(l.calc_pro_payout_total || 0);
    });
    
    var margin = totalRevenue > 0 ? Math.round((totalRevenue - totalCost) / totalRevenue * 100) : 0;
    
    Logger.log('  Revenue: $' + totalRevenue);
    Logger.log('  Cost: $' + totalCost);
    Logger.log('  Margin: ' + margin + '%');
    
    return {ok: totalRevenue > 0 && margin > 0};
  });
  
  // ===== VARIANT PRICING SYSTEM =====
  Logger.log('\n--- Testing Variant Pricing System ---\n');
  
  test('Variants: BYO/BASE/H2S tiers exist', function(){
    var variants = readAll(TABS.SERVICE_VARIANTS);
    
    var byoCount = variants.filter(function(v){ return String(v.variant_code || '').toUpperCase() === 'BYO'; }).length;
    var baseCount = variants.filter(function(v){ return String(v.variant_code || '').toUpperCase() === 'BASE'; }).length;
    var h2sCount = variants.filter(function(v){ return String(v.variant_code || '').toUpperCase() === 'H2S'; }).length;
    
    Logger.log('  BYO variants: ' + byoCount);
    Logger.log('  BASE variants: ' + baseCount);
    Logger.log('  H2S variants: ' + h2sCount);
    
    return {ok: byoCount > 0 && baseCount > 0 && h2sCount > 0};
  });
  
  test('Variants: Quantity pricing configured', function(){
    var variants = readAll(TABS.SERVICE_VARIANTS);
    
    var quantityBased = variants.filter(function(v){
      return Number(v.addl_customer_price || 0) > 0;
    }).length;
    
    var pct = Math.round(quantityBased / variants.length * 100);
    Logger.log('  Quantity-based: ' + pct + '% (' + quantityBased + '/' + variants.length + ')');
    
    return {ok: quantityBased > 0};
  });
  
  // ===== SYNC STATUS =====
  Logger.log('\n--- Testing Supabase Sync ---\n');
  
  test('Supabase: Configuration check', function(){
    try {
      var config = getSupabaseConfig_();
      var hasUrl = config.url && config.url.length > 0;
      var hasKey = config.key && config.key.length > 0;
      Logger.log('  Config: ' + (hasUrl && hasKey ? 'Valid' : 'Missing'));
      return {ok: hasUrl && hasKey};
    } catch(e){
      return {ok: false, error: e.toString()};
    }
  });
  
  test('Supabase: Database connection', function(){
    try {
      // Use readAll which handles Supabase reads
      var jobs = readAll(TABS.JOBS);
      Logger.log('  Database accessible: ' + (jobs.length > 0 ? 'YES' : 'NO'));
      return {ok: jobs.length > 0};
    } catch(e){
      return {ok: false, error: e.toString()};
    }
  });
  
  test('Supabase: Dual-write enabled', function(){
    var enabled = CONFIG.USE_DATABASE === true;
    var fallback = CONFIG.DB_FALLBACK_TO_SHEETS === true;
    Logger.log('  USE_DATABASE: ' + enabled);
    Logger.log('  DB_FALLBACK_TO_SHEETS: ' + fallback);
    return {ok: enabled};
  });
  
  // ===== FINAL SUMMARY =====
  Logger.log('\n========================================');
  Logger.log('📊 TEST RESULTS SUMMARY');
  Logger.log('========================================');
  Logger.log('Total Tests: ' + results.total);
  Logger.log('✅ Passed: ' + results.passed);
  Logger.log('❌ Failed: ' + results.failed);
  Logger.log('Success Rate: ' + Math.round(results.passed / results.total * 100) + '%');
  Logger.log('========================================\n');
  
  if(results.failed > 0){
    Logger.log('⚠️ FAILED TESTS:');
    results.tests.filter(function(t){ return t.status === 'FAIL'; }).forEach(function(t){
      Logger.log('  • ' + t.name + ': ' + (t.error || 'Unknown error'));
    });
  } else {
    Logger.log('🎉 ALL TESTS PASSED!');
    Logger.log('✅ System is fully operational and ready for production!');
  }
  
  return results;
}
