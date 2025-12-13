/**
 * AI-POWERED BUSINESS INTELLIGENCE ANALYZER
 * Aggregates all operational metrics and provides executive-level insights
 * No bullshit. Pure data-driven analysis.
 */

/**
 * COLLECT ALL BUSINESS METRICS
 * Queries database and calculates precise KPIs
 * PRIMARY SOURCE: SUPABASE (Sheets used for backup writes only)
 */
function collectBusinessMetrics(){
  Logger.log('Collecting business metrics from Supabase...');
  
  // Read from Supabase - primary data source
  function readFromSupabase(table){
    try {
      var props = PropertiesService.getScriptProperties();
      var url = props.getProperty('SUPABASE_URL');
      var key = props.getProperty('SUPABASE_ANON_KEY');
      
      if(!url || !key){
        Logger.log('Supabase credentials not configured - cannot fetch ' + table);
        return [];
      }
      
      var endpoint = url + '/rest/v1/' + table + '?select=*';
      var options = {
        method: 'get',
        headers: {
          'apikey': key,
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json'
        },
        muteHttpExceptions: true
      };
      var response = UrlFetchApp.fetch(endpoint, options);
      if(response.getResponseCode() === 200){
        return JSON.parse(response.getContentText());
      }
      Logger.log('Supabase fetch failed for ' + table + ': ' + response.getResponseCode());
      return [];
    } catch(e){
      Logger.log('Error fetching from Supabase ' + table + ': ' + e.toString());
      return [];
    }
  }
  
  var jobs = readFromSupabase('h2s_dispatch_jobs');
  var jobLines = readFromSupabase('h2s_dispatch_job_lines');
  var services = indexBy(readFromSupabase('h2s_dispatch_services'), 'service_id');
  var pros = readFromSupabase('h2s_dispatch_pros');
  var payouts = readFromSupabase('h2s_dispatch_payouts_ledger');
  var variants = readFromSupabase('h2s_dispatch_service_variants');
  var assignments = readFromSupabase('h2s_dispatch_job_assignments');
  
  // Filter completed jobs only for revenue metrics
  var completedJobs = jobs.filter(function(j){ return j.status === 'completed'; });
  var completedJobIds = {};
  completedJobs.forEach(function(j){ completedJobIds[j.job_id] = true; });
  
  var completedJobLines = jobLines.filter(function(l){ return completedJobIds[l.job_id]; });
  
  // REVENUE INTELLIGENCE
  var totalRevenue = 0;
  var totalCost = 0;
  completedJobLines.forEach(function(line){
    totalRevenue += Number(line.line_customer_total || 0);
    totalCost += Number(line.calc_pro_payout_total || 0);
  });
  
  var grossMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0;
  var avgJobValue = completedJobs.length > 0 ? totalRevenue / completedJobs.length : 0;
  
  // OPERATIONAL EFFICIENCY
  var jobsPending = jobs.filter(function(j){ 
    return j.status === 'assigned' || j.status === 'offered' || j.status === 'pending'; 
  }).length;
  
  var completionRate = jobs.length > 0 ? (completedJobs.length / jobs.length * 100) : 0;
  
  // Calculate average time to complete (in days)
  var totalDays = 0;
  var jobsWithDates = 0;
  completedJobs.forEach(function(j){
    if(j.created_at && j.updated_at){
      var created = new Date(j.created_at);
      var completed = new Date(j.updated_at);
      var days = (completed - created) / (1000 * 60 * 60 * 24);
      if(days >= 0 && days < 365){ // Sanity check
        totalDays += days;
        jobsWithDates++;
      }
    }
  });
  var avgTimeToComplete = jobsWithDates > 0 ? totalDays / jobsWithDates : 0;
  
  // GEOGRAPHIC PERFORMANCE
  var citiesMap = {};
  completedJobs.forEach(function(j){
    var city = String(j.service_city || 'Unknown').trim();
    if(!citiesMap[city]){
      citiesMap[city] = {name: city, jobs: 0, revenue: 0, cost: 0};
    }
    citiesMap[city].jobs++;
  });
  
  completedJobLines.forEach(function(line){
    var job = jobs.find(function(j){ return j.job_id === line.job_id; });
    if(job){
      var city = String(job.service_city || 'Unknown').trim();
      if(citiesMap[city]){
        citiesMap[city].revenue += Number(line.line_customer_total || 0);
        citiesMap[city].cost += Number(line.calc_pro_payout_total || 0);
      }
    }
  });
  
  var cities = Object.keys(citiesMap).map(function(city){
    var c = citiesMap[city];
    var margin = c.revenue > 0 ? ((c.revenue - c.cost) / c.revenue * 100) : 0;
    var avgJobValue = c.jobs > 0 ? c.revenue / c.jobs : 0;
    
    // Count pros serving this city
    var prosInCity = pros.filter(function(p){
      return String(p.home_city || '').trim() === city;
    }).length;
    
    return {
      name: city,
      jobs: c.jobs,
      revenue: Math.round(c.revenue),
      margin: Math.round(margin * 10) / 10,
      avg_job_value: Math.round(avgJobValue),
      pro_coverage: prosInCity
    };
  }).sort(function(a, b){ return b.revenue - a.revenue; });
  
  // PRICING TIER ANALYSIS
  var byoJobs = jobLines.filter(function(l){ return String(l.variant_code || '').toUpperCase() === 'BYO'; });
  var baseJobs = jobLines.filter(function(l){ return String(l.variant_code || '').toUpperCase() === 'BASE'; });
  var h2sJobs = jobLines.filter(function(l){ return String(l.variant_code || '').toUpperCase() === 'H2S'; });
  
  function calcTierMetrics(tierLines){
    var revenue = 0;
    var cost = 0;
    tierLines.forEach(function(l){
      if(completedJobIds[l.job_id]){
        revenue += Number(l.line_customer_total || 0);
        cost += Number(l.calc_pro_payout_total || 0);
      }
    });
    var margin = revenue > 0 ? ((revenue - cost) / revenue * 100) : 0;
    return {jobs: tierLines.length, revenue: Math.round(revenue), margin: Math.round(margin * 10) / 10};
  }
  
  var byoMetrics = calcTierMetrics(byoJobs);
  var baseMetrics = calcTierMetrics(baseJobs);
  var h2sMetrics = calcTierMetrics(h2sJobs);
  
  // WORKFORCE ANALYSIS
  var activePros = pros.filter(function(p){ return p.status === 'active'; }).length;
  
  // Calculate pro utilization
  var totalMaxCapacity = 0;
  pros.forEach(function(p){
    if(p.status === 'active'){
      totalMaxCapacity += Number(p.max_jobs_per_day || 3);
    }
  });
  
  var utilizationRate = totalMaxCapacity > 0 ? (jobsPending / totalMaxCapacity * 100) : 0;
  
  // Top performing pros
  var proEarnings = {};
  payouts.forEach(function(p){
    var proId = p.pro_id;
    if(!proEarnings[proId]) proEarnings[proId] = {total: 0, jobs: 0};
    proEarnings[proId].total += Number(p.amount || 0);
    proEarnings[proId].jobs++;
  });
  
  var topPerformers = Object.keys(proEarnings).map(function(proId){
    var pro = pros.find(function(p){ return p.pro_id === proId; });
    return {
      pro_id: proId,
      name: pro ? pro.name : 'Unknown',
      earnings: Math.round(proEarnings[proId].total),
      jobs: proEarnings[proId].jobs,
      avg_per_job: Math.round(proEarnings[proId].total / proEarnings[proId].jobs)
    };
  }).sort(function(a, b){ return b.earnings - a.earnings; }).slice(0, 5);
  
  var avgProEarnings = activePros > 0 ? totalCost / activePros : 0;
  
  // GROWTH METRICS
  var now = new Date();
  var lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  
  var lastMonthJobs = completedJobs.filter(function(j){
    var d = new Date(j.created_at);
    return d >= lastMonth && d < thisMonth;
  }).length;
  
  var thisMonthJobs = completedJobs.filter(function(j){
    var d = new Date(j.created_at);
    return d >= thisMonth;
  }).length;
  
  var momGrowth = lastMonthJobs > 0 ? ((thisMonthJobs - lastMonthJobs) / lastMonthJobs * 100) : 0;
  
  // Unique customers
  var customerMap = {};
  jobs.forEach(function(j){
    var email = String(j.customer_email || '').trim().toLowerCase();
    if(email){
      if(!customerMap[email]) customerMap[email] = 0;
      customerMap[email]++;
    }
  });
  
  var uniqueCustomers = Object.keys(customerMap).length;
  var repeatCustomers = Object.keys(customerMap).filter(function(email){ 
    return customerMap[email] > 1; 
  }).length;
  var repeatRate = uniqueCustomers > 0 ? (repeatCustomers / uniqueCustomers * 100) : 0;
  
  // CAPACITY & RISKS
  var currentLoad = jobsPending;
  var maxCapacity = totalMaxCapacity * 30; // Approximate monthly capacity
  var capacityUtilization = maxCapacity > 0 ? (jobs.length / maxCapacity * 100) : 0;
  
  // Low margin jobs (under 40%)
  var lowMarginJobs = completedJobLines.filter(function(line){
    var revenue = Number(line.line_customer_total || 0);
    var cost = Number(line.calc_pro_payout_total || 0);
    var margin = revenue > 0 ? ((revenue - cost) / revenue * 100) : 0;
    return margin < 40;
  }).length;
  
  // Understaffed cities (>10 jobs but <2 pros)
  var understaffedCities = cities.filter(function(c){
    return c.jobs > 10 && c.pro_coverage < 2;
  }).map(function(c){ return c.name; });
  
  // Pending payouts
  var pendingPayouts = payouts.filter(function(p){ return !p.paid_at; });
  var totalPendingAmount = 0;
  pendingPayouts.forEach(function(p){
    totalPendingAmount += Number(p.amount || 0);
  });
  
  // SERVICE PERFORMANCE
  var servicePerformance = {};
  completedJobLines.forEach(function(line){
    var svcId = line.service_id;
    var svc = services[svcId];
    if(svc){
      var svcName = svc.name || 'Unknown';
      if(!servicePerformance[svcName]){
        servicePerformance[svcName] = {jobs: 0, revenue: 0, cost: 0};
      }
      servicePerformance[svcName].jobs++;
      servicePerformance[svcName].revenue += Number(line.line_customer_total || 0);
      servicePerformance[svcName].cost += Number(line.calc_pro_payout_total || 0);
    }
  });
  
  var topServices = Object.keys(servicePerformance).map(function(name){
    var s = servicePerformance[name];
    var margin = s.revenue > 0 ? ((s.revenue - s.cost) / s.revenue * 100) : 0;
    return {
      name: name,
      jobs: s.jobs,
      revenue: Math.round(s.revenue),
      margin: Math.round(margin * 10) / 10
    };
  }).sort(function(a, b){ return b.revenue - a.revenue; }).slice(0, 10);
  
  return {
    revenue: {
      total: Math.round(totalRevenue),
      cost: Math.round(totalCost),
      margin: Math.round(grossMargin * 10) / 10,
      avg_job_value: Math.round(avgJobValue)
    },
    operations: {
      jobs_completed: completedJobs.length,
      jobs_pending: jobsPending,
      completion_rate: Math.round(completionRate * 10) / 10,
      avg_time_to_complete: Math.round(avgTimeToComplete * 10) / 10
    },
    geography: {
      total_cities: cities.length,
      top_cities: cities.slice(0, 10),
      understaffed_cities: understaffedCities
    },
    pricing: {
      byo: byoMetrics,
      base: baseMetrics,
      h2s: h2sMetrics
    },
    workforce: {
      total_pros: pros.length,
      active_pros: activePros,
      utilization_rate: Math.round(utilizationRate * 10) / 10,
      avg_earnings: Math.round(avgProEarnings),
      top_performers: topPerformers
    },
    growth: {
      mom_growth: Math.round(momGrowth * 10) / 10,
      unique_customers: uniqueCustomers,
      repeat_rate: Math.round(repeatRate * 10) / 10,
      last_month_jobs: lastMonthJobs,
      this_month_jobs: thisMonthJobs
    },
    capacity: {
      current_load: currentLoad,
      max_capacity: maxCapacity,
      utilization_pct: Math.round(capacityUtilization * 10) / 10
    },
    risks: {
      low_margin_jobs: lowMarginJobs,
      pending_payouts_count: pendingPayouts.length,
      pending_payouts_amount: Math.round(totalPendingAmount),
      understaffed_markets: understaffedCities.length
    },
    services: {
      top_services: topServices
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * ANALYZE BUSINESS WITH AI
 * Sends metrics to OpenAI GPT for executive-level insights
 */
function analyzeBusinessWithAI(apiKey){
  if(!apiKey){
    return {ok: false, error: 'API key required'};
  }
  
  Logger.log('Collecting metrics for AI analysis...');
  var metrics = collectBusinessMetrics();
  
  Logger.log('Preparing AI analysis request...');
  
  // Craft business-focused prompt
  var prompt = `You are analyzing a home services dispatch business. Provide a concise executive analysis based on these metrics:

REVENUE & PROFITABILITY:
- Total Revenue: $${metrics.revenue.total}
- Total Cost: $${metrics.revenue.cost}
- Gross Margin: ${metrics.revenue.margin}%
- Average Job Value: $${metrics.revenue.avg_job_value}

OPERATIONS:
- Jobs Completed: ${metrics.operations.jobs_completed}
- Jobs Pending: ${metrics.operations.jobs_pending}
- Completion Rate: ${metrics.operations.completion_rate}%
- Avg Time to Complete: ${metrics.operations.avg_time_to_complete} days

GEOGRAPHIC PERFORMANCE:
- Active Cities: ${metrics.geography.total_cities}
- Top Cities by Revenue: ${JSON.stringify(metrics.geography.top_cities.slice(0, 5))}
- Understaffed Markets: ${metrics.geography.understaffed_cities.join(', ') || 'None'}

PRICING TIERS:
- BYO (Budget): ${metrics.pricing.byo.jobs} jobs, $${metrics.pricing.byo.revenue}, ${metrics.pricing.byo.margin}% margin
- BASE (Standard): ${metrics.pricing.base.jobs} jobs, $${metrics.pricing.base.revenue}, ${metrics.pricing.base.margin}% margin
- H2S (Premium): ${metrics.pricing.h2s.jobs} jobs, $${metrics.pricing.h2s.revenue}, ${metrics.pricing.h2s.margin}% margin

WORKFORCE:
- Active Pros: ${metrics.workforce.active_pros}
- Utilization Rate: ${metrics.workforce.utilization_rate}%
- Avg Pro Earnings: $${metrics.workforce.avg_earnings}

GROWTH:
- Month-over-Month: ${metrics.growth.mom_growth}%
- Unique Customers: ${metrics.growth.unique_customers}
- Repeat Rate: ${metrics.growth.repeat_rate}%

CAPACITY & RISKS:
- Current Load: ${metrics.capacity.current_load} pending jobs
- Capacity Utilization: ${metrics.capacity.utilization_pct}%
- Low Margin Jobs: ${metrics.risks.low_margin_jobs}
- Pending Payouts: ${metrics.risks.pending_payouts_count} ($${metrics.risks.pending_payouts_amount})
- Understaffed Markets: ${metrics.risks.understaffed_markets}

Provide analysis in this format:
1. OPERATIONAL HEALTH: What's working well and what's broken
2. BOTTLENECKS: What's limiting growth right now
3. MARGIN ANALYSIS: Where money is being lost or left on table
4. CAPACITY: Can we handle more volume or do we need more pros
5. CRITICAL FIXES: Top 3 things to fix before scaling
6. GROWTH OPPORTUNITIES: Where to focus expansion efforts

Be direct. No fluff. Focus on actionable insights.`;

  try {
    var url = 'https://api.openai.com/v1/chat/completions';
    var payload = {
      model: 'gpt-4o',
      messages: [{
        role: 'system',
        content: 'You are a business intelligence analyst providing executive-level insights for a home services dispatch company.'
      }, {
        role: 'user',
        content: prompt
      }],
      temperature: 0.7,
      max_tokens: 2000
    };
    
    var options = {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    Logger.log('Sending request to OpenAI API...');
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    
    if(code !== 200){
      Logger.log('API Error: ' + code);
      Logger.log(response.getContentText());
      return {ok: false, error: 'API request failed: ' + code};
    }
    
    var result = JSON.parse(response.getContentText());
    var analysis = result.choices && result.choices[0] && result.choices[0].message 
      ? result.choices[0].message.content 
      : 'No analysis returned';
    
    Logger.log('Analysis received successfully');
    
    return {
      ok: true,
      metrics: metrics,
      analysis: analysis,
      timestamp: new Date().toISOString()
    };
    
  } catch(e){
    Logger.log('Error: ' + e.toString());
    return {ok: false, error: e.toString()};
  }
}

/**
 * GET BUSINESS ANALYSIS
 * Main entry point for dashboard
 * Usage: getBusinessAnalysis('your-anthropic-api-key')
 */
function getBusinessAnalysis(apiKey){
  Logger.log('\n========================================');
  Logger.log('AI BUSINESS INTELLIGENCE ANALYSIS');
  Logger.log('========================================\n');
  
  var result = analyzeBusinessWithAI(apiKey);
  
  if(!result.ok){
    Logger.log('ERROR: ' + result.error);
    return result;
  }
  
  Logger.log('\n--- METRICS SUMMARY ---');
  Logger.log('Revenue: $' + result.metrics.revenue.total);
  Logger.log('Margin: ' + result.metrics.revenue.margin + '%');
  Logger.log('Jobs Completed: ' + result.metrics.operations.jobs_completed);
  Logger.log('Active Pros: ' + result.metrics.workforce.active_pros);
  Logger.log('Growth: ' + result.metrics.growth.mom_growth + '% MoM');
  
  Logger.log('\n--- AI ANALYSIS ---');
  Logger.log(result.analysis);
  Logger.log('\n========================================\n');
  
  return result;
}
