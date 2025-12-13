/**
 * HOME2SMART DISPATCH - ANALYTICS & INTELLIGENCE ENGINE
 * 
 * ADD THIS FILE TO YOUR GOOGLE APPS SCRIPT PROJECT (same project as Operations.js)
 * 
 * This module provides comprehensive analytics and AI-powered insights
 * across all dispatch operations. It queries the Supabase database for
 * precise metrics and generates actionable intelligence.
 * 
 * SHARED RESOURCES:
 * - Uses same Script Properties as Operations.js (SUPABASE_URL, SUPABASE_ANON_KEY)
 * - Reads from same Supabase database
 * - Can be called from Operations.js or independently
 * 
 * KEY CAPABILITIES:
 * - Real-time operational metrics (job flow, pro utilization, revenue)
 * - Bottleneck detection (assignment delays, capacity issues, cancellations)
 * - Geographic analysis (coverage gaps, market opportunities)
 * - Pro performance scoring (reliability, speed, satisfaction)
 * - Customer behavior patterns (repeat customers, lifetime value)
 * - AI-ready analysis payload generation
 * 
 * MAIN FUNCTIONS:
 * - getDispatchIntelligence(options) → Full system analysis
 * - getJobFlowMetrics(daysBack) → Job pipeline metrics
 * - getProUtilizationMetrics(daysBack) → Pro efficiency metrics
 * - getServicePerformanceMetrics(daysBack) → Service revenue/popularity
 * - getGeographicCoverageMetrics(daysBack) → Coverage analysis
 * - detectBottlenecks(daysBack) → Automated problem detection
 * - generateAIAnalysisPayload(daysBack) → AI-ready data for interpretation
 */

/* ========================= CONFIGURATION ========================= */

var ANALYTICS_CONFIG = {
  // Time periods for analysis (in days)
  SHORT_TERM: 7,
  MEDIUM_TERM: 30,
  LONG_TERM: 90,
  
  // Thresholds for bottleneck detection
  CRITICAL_ASSIGNMENT_DELAY_HOURS: 24,
  WARNING_ASSIGNMENT_DELAY_HOURS: 12,
  LOW_UTILIZATION_THRESHOLD: 0.5, // 50% or less
  HIGH_CANCELLATION_RATE: 0.15,   // 15% or more
  
  // Geographic intelligence
  MIN_JOBS_FOR_MARKET_ANALYSIS: 5,
  UNDERSERVED_SUPPLY_DEMAND_RATIO: 0.5
};

/* ========================= DATABASE HELPERS ========================= */

/**
 * Get Supabase credentials from Script Properties
 * SHARED with Operations.js - uses same credentials
 */
function getSupabaseConfig_Analytics() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_ANON_KEY');
  
  if (!url || !key) {
    throw new Error('Supabase credentials not configured. Run setupSupabaseCredentials() in Operations.js first.');
  }
  
  return { url: url, key: key };
}

/**
 * Execute a SQL query via Supabase REST API
 * Uses PostgREST filters for precise queries
 */
function supabaseSelect_Analytics(table, options) {
  var config = getSupabaseConfig_Analytics();
  options = options || {};
  
  var url = config.url + '/rest/v1/' + table;
  var params = [];
  
  if (options.select) params.push('select=' + options.select);
  if (options.filter) params.push(options.filter);
  if (options.order) params.push('order=' + options.order);
  if (options.limit) params.push('limit=' + options.limit);
  
  if (params.length > 0) url += '?' + params.join('&');
  
  var requestOptions = {
    method: 'get',
    headers: {
      'apikey': config.key,
      'Authorization': 'Bearer ' + config.key
    },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, requestOptions);
  
  if (response.getResponseCode() !== 200) {
    throw new Error('Query failed: ' + response.getContentText());
  }
  
  return JSON.parse(response.getContentText());
}

/**
 * Get count of records matching criteria
 */
function supabaseCount_Analytics(table, filter) {
  var config = getSupabaseConfig_Analytics();
  var url = config.url + '/rest/v1/' + table + '?select=*&limit=1';
  
  if (filter) url += '&' + filter;
  
  var options = {
    method: 'get',
    headers: {
      'apikey': config.key,
      'Authorization': 'Bearer ' + config.key,
      'Prefer': 'count=exact'
    },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  
  if (response.getResponseCode() === 200 || response.getResponseCode() === 206) {
    var headers = response.getHeaders();
    var contentRange = headers['Content-Range'] || headers['content-range'];
    if (contentRange) {
      var parts = contentRange.split('/');
      if (parts.length === 2) {
        return parseInt(parts[1]);
      }
    }
  }
  
  return 0;
}

/* ========================= CORE METRICS ========================= */

/**
 * Get job flow metrics - how jobs move through the system
 */
function getJobFlowMetrics(daysBack) {
  daysBack = daysBack || ANALYTICS_CONFIG.MEDIUM_TERM;
  
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  var isoDate = cutoffDate.toISOString();
  
  // Get all jobs in time period
  var jobs = supabaseSelect_Analytics('h2s_dispatch_jobs', {
    select: 'job_id,status,start_iso,created_at,updated_at',
    filter: 'created_at=gte.' + isoDate
  });
  
  // Calculate metrics
  var total = jobs.length;
  var byStatus = {};
  var totalRevenue = 0;
  var completedCount = 0;
  var cancelledCount = 0;
  var assignmentTimes = [];
  
  jobs.forEach(function(job) {
    // Count by status
    var status = job.status || 'unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;
    
    // Revenue from completed jobs
    if (status === 'completed' && job.total_price) {
      totalRevenue += parseFloat(job.total_price);
      completedCount++;
    }
    
    if (status === 'cancelled') {
      cancelledCount++;
    }
    
    // Calculate time to assignment
    if (job.created_at && job.updated_at) {
      var created = new Date(job.created_at);
      var updated = new Date(job.updated_at);
      var hoursToAssign = (updated - created) / (1000 * 60 * 60);
      if (hoursToAssign > 0 && hoursToAssign < 168) { // Less than 1 week
        assignmentTimes.push(hoursToAssign);
      }
    }
  });
  
  // Calculate averages
  var avgAssignmentTime = assignmentTimes.length > 0 
    ? assignmentTimes.reduce(function(a, b) { return a + b; }, 0) / assignmentTimes.length 
    : 0;
  
  var completionRate = total > 0 ? (completedCount / total) : 0;
  var cancellationRate = total > 0 ? (cancelledCount / total) : 0;
  
  return {
    period_days: daysBack,
    total_jobs: total,
    by_status: byStatus,
    completed_jobs: completedCount,
    cancelled_jobs: cancelledCount,
    completion_rate: Math.round(completionRate * 100) / 100,
    cancellation_rate: Math.round(cancellationRate * 100) / 100,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    avg_revenue_per_job: completedCount > 0 ? Math.round((totalRevenue / completedCount) * 100) / 100 : 0,
    avg_assignment_time_hours: Math.round(avgAssignmentTime * 10) / 10,
    bottleneck_alert: avgAssignmentTime > ANALYTICS_CONFIG.WARNING_ASSIGNMENT_DELAY_HOURS
  };
}

/**
 * Get pro utilization metrics - how efficiently pros are being used
 */
function getProUtilizationMetrics(daysBack) {
  daysBack = daysBack || ANALYTICS_CONFIG.MEDIUM_TERM;
  
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  var isoDate = cutoffDate.toISOString();
  
  // Get all pros
  var pros = supabaseSelect_Analytics('h2s_dispatch_pros', {
    select: 'pro_id,name,status'
  });
  
  // Get assignments in time period
  var assignments = supabaseSelect_Analytics('h2s_dispatch_job_assignments', {
    select: 'pro_id,assigned_at,job_id',
    filter: 'assigned_at=gte.' + isoDate
  });
  
  // Count assignments per pro
  var assignmentCounts = {};
  assignments.forEach(function(a) {
    if (a.pro_id) {
      assignmentCounts[a.pro_id] = (assignmentCounts[a.pro_id] || 0) + 1;
    }
  });
  
  var activePros = 0;
  var totalAssignments = assignments.length;
  var proPerformance = [];
  
  pros.forEach(function(pro) {
    var jobCount = assignmentCounts[pro.pro_id] || 0;
    if (jobCount > 0) activePros++;
    
    proPerformance.push({
      pro_id: pro.pro_id,
      name: pro.name,
      jobs_completed: jobCount,
      status: pro.status
    });
  });
  
  // Sort by jobs completed
  proPerformance.sort(function(a, b) { return b.jobs_completed - a.jobs_completed; });
  
  var avgJobsPerPro = activePros > 0 ? totalAssignments / activePros : 0;
  
  return {
    period_days: daysBack,
    total_pros: pros.length,
    active_pros: activePros,
    utilization_rate: pros.length > 0 ? Math.round((activePros / pros.length) * 100) / 100 : 0,
    total_assignments: totalAssignments,
    avg_jobs_per_pro: Math.round(avgJobsPerPro * 10) / 10,
    top_performers: proPerformance.slice(0, 5),
    underutilized_pros: proPerformance.filter(function(p) { 
      return p.jobs_completed < (avgJobsPerPro * 0.5); 
    }).length
  };
}

/**
 * Get service performance metrics - which services are most profitable/popular
 */
function getServicePerformanceMetrics(daysBack) {
  daysBack = daysBack || ANALYTICS_CONFIG.MEDIUM_TERM;
  
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  var isoDate = cutoffDate.toISOString();
  
  // Get all services
  var services = supabaseSelect_Analytics('h2s_dispatch_services', {
    select: 'service_id,name,category,base_price'
  });
  
  // Get job lines in time period (links jobs to services)
  var jobLines = supabaseSelect_Analytics('h2s_dispatch_job_lines', {
    select: 'service_id,quantity,subtotal',
    filter: 'created_at=gte.' + isoDate
  });
  
  // Aggregate by service
  var serviceStats = {};
  
  jobLines.forEach(function(line) {
    if (!line.service_id) return;
    
    if (!serviceStats[line.service_id]) {
      serviceStats[line.service_id] = {
        count: 0,
        revenue: 0,
        quantity: 0
      };
    }
    
    serviceStats[line.service_id].count++;
    serviceStats[line.service_id].quantity += parseInt(line.quantity) || 1;
    serviceStats[line.service_id].revenue += parseFloat(line.subtotal) || 0;
  });
  
  // Map to service names
  var performance = services.map(function(svc) {
    var stats = serviceStats[svc.service_id] || { count: 0, revenue: 0, quantity: 0 };
    
    return {
      service_id: svc.service_id,
      name: svc.name,
      category: svc.category,
      bookings: stats.count,
      revenue: Math.round(stats.revenue * 100) / 100,
      avg_revenue_per_booking: stats.count > 0 
        ? Math.round((stats.revenue / stats.count) * 100) / 100 
        : 0
    };
  });
  
  // Sort by revenue
  performance.sort(function(a, b) { return b.revenue - a.revenue; });
  
  var totalRevenue = performance.reduce(function(sum, s) { return sum + s.revenue; }, 0);
  
  return {
    period_days: daysBack,
    total_services: services.length,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    top_services: performance.slice(0, 10),
    low_performing_services: performance.filter(function(s) { 
      return s.bookings === 0; 
    }).length
  };
}

/**
 * Get geographic coverage metrics - where are we serving customers
 */
function getGeographicCoverageMetrics(daysBack) {
  daysBack = daysBack || ANALYTICS_CONFIG.MEDIUM_TERM;
  
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  var isoDate = cutoffDate.toISOString();
  
  // Get jobs with location data
  var jobs = supabaseSelect_Analytics('h2s_dispatch_jobs', {
    select: 'service_state,service_city,service_zip,status',
    filter: 'created_at=gte.' + isoDate
  });
  
  var byState = {};
  var byCity = {};
  var byZip = {};
  
  jobs.forEach(function(job) {
    // Count by state
    if (job.service_state) {
      if (!byState[job.service_state]) {
        byState[job.service_state] = { total: 0, completed: 0 };
      }
      byState[job.service_state].total++;
      if (job.status === 'completed') byState[job.service_state].completed++;
    }
    
    // Count by city
    if (job.service_city) {
      var cityKey = job.service_city + ', ' + (job.service_state || '');
      if (!byCity[cityKey]) {
        byCity[cityKey] = { total: 0, completed: 0 };
      }
      byCity[cityKey].total++;
      if (job.status === 'completed') byCity[cityKey].completed++;
    }
    
    // Count by ZIP
    if (job.service_zip) {
      if (!byZip[job.service_zip]) {
        byZip[job.service_zip] = { total: 0, completed: 0 };
      }
      byZip[job.service_zip].total++;
      if (job.status === 'completed') byZip[job.service_zip].completed++;
    }
  });
  
  // Convert to arrays and sort
  var stateList = Object.keys(byState).map(function(k) {
    return {
      state: k,
      jobs: byState[k].total,
      completed: byState[k].completed,
      completion_rate: byState[k].total > 0 
        ? Math.round((byState[k].completed / byState[k].total) * 100) / 100 
        : 0
    };
  }).sort(function(a, b) { return b.jobs - a.jobs; });
  
  var cityList = Object.keys(byCity).map(function(k) {
    return {
      city: k,
      jobs: byCity[k].total,
      completed: byCity[k].completed
    };
  }).sort(function(a, b) { return b.jobs - a.jobs; });
  
  return {
    period_days: daysBack,
    total_jobs: jobs.length,
    states_served: Object.keys(byState).length,
    cities_served: Object.keys(byCity).length,
    zip_codes_served: Object.keys(byZip).length,
    top_states: stateList.slice(0, 5),
    top_cities: cityList.slice(0, 10)
  };
}

/**
 * Get customer behavior metrics - repeat customers, lifetime value
 */
function getCustomerBehaviorMetrics(daysBack) {
  daysBack = daysBack || ANALYTICS_CONFIG.LONG_TERM;
  
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  var isoDate = cutoffDate.toISOString();
  
  // Get jobs with customer data
  var jobs = supabaseSelect_Analytics('h2s_dispatch_jobs', {
    select: 'customer_id,total_price,status,created_at',
    filter: 'created_at=gte.' + isoDate
  });
  
  var customerStats = {};
  
  jobs.forEach(function(job) {
    if (!job.customer_id) return;
    
    if (!customerStats[job.customer_id]) {
      customerStats[job.customer_id] = {
        bookings: 0,
        revenue: 0,
        first_booking: job.created_at,
        last_booking: job.created_at
      };
    }
    
    customerStats[job.customer_id].bookings++;
    
    if (job.status === 'completed' && job.total_price) {
      customerStats[job.customer_id].revenue += parseFloat(job.total_price);
    }
    
    // Track first and last booking dates
    if (new Date(job.created_at) < new Date(customerStats[job.customer_id].first_booking)) {
      customerStats[job.customer_id].first_booking = job.created_at;
    }
    if (new Date(job.created_at) > new Date(customerStats[job.customer_id].last_booking)) {
      customerStats[job.customer_id].last_booking = job.created_at;
    }
  });
  
  var totalCustomers = Object.keys(customerStats).length;
  var repeatCustomers = 0;
  var totalLTV = 0;
  
  Object.keys(customerStats).forEach(function(custId) {
    var stats = customerStats[custId];
    if (stats.bookings > 1) repeatCustomers++;
    totalLTV += stats.revenue;
  });
  
  var repeatRate = totalCustomers > 0 ? repeatCustomers / totalCustomers : 0;
  var avgLTV = totalCustomers > 0 ? totalLTV / totalCustomers : 0;
  
  return {
    period_days: daysBack,
    total_customers: totalCustomers,
    repeat_customers: repeatCustomers,
    repeat_rate: Math.round(repeatRate * 100) / 100,
    avg_lifetime_value: Math.round(avgLTV * 100) / 100,
    total_customer_lifetime_value: Math.round(totalLTV * 100) / 100
  };
}

/* ========================= BOTTLENECK DETECTION ========================= */

/**
 * Detect operational bottlenecks across the system
 */
function detectBottlenecks(daysBack) {
  daysBack = daysBack || ANALYTICS_CONFIG.SHORT_TERM;
  
  var bottlenecks = [];
  
  // Check job flow metrics
  var jobFlow = getJobFlowMetrics(daysBack);
  
  if (jobFlow.cancellation_rate > ANALYTICS_CONFIG.HIGH_CANCELLATION_RATE) {
    bottlenecks.push({
      type: 'HIGH_CANCELLATION_RATE',
      severity: 'critical',
      metric: 'cancellation_rate',
      value: jobFlow.cancellation_rate,
      threshold: ANALYTICS_CONFIG.HIGH_CANCELLATION_RATE,
      description: 'Job cancellation rate is above acceptable threshold',
      recommendation: 'Review cancellation reasons, improve pro matching, address customer concerns'
    });
  }
  
  if (jobFlow.avg_assignment_time_hours > ANALYTICS_CONFIG.CRITICAL_ASSIGNMENT_DELAY_HOURS) {
    bottlenecks.push({
      type: 'SLOW_ASSIGNMENT',
      severity: 'critical',
      metric: 'avg_assignment_time_hours',
      value: jobFlow.avg_assignment_time_hours,
      threshold: ANALYTICS_CONFIG.CRITICAL_ASSIGNMENT_DELAY_HOURS,
      description: 'Jobs taking too long to assign to pros',
      recommendation: 'Increase pro availability, improve matching algorithm, add more pros in high-demand areas'
    });
  } else if (jobFlow.avg_assignment_time_hours > ANALYTICS_CONFIG.WARNING_ASSIGNMENT_DELAY_HOURS) {
    bottlenecks.push({
      type: 'SLOW_ASSIGNMENT',
      severity: 'warning',
      metric: 'avg_assignment_time_hours',
      value: jobFlow.avg_assignment_time_hours,
      threshold: ANALYTICS_CONFIG.WARNING_ASSIGNMENT_DELAY_HOURS,
      description: 'Job assignment time is elevated',
      recommendation: 'Monitor pro capacity, consider proactive outreach to pros'
    });
  }
  
  // Check pro utilization
  var proUtil = getProUtilizationMetrics(daysBack);
  
  if (proUtil.utilization_rate < ANALYTICS_CONFIG.LOW_UTILIZATION_THRESHOLD) {
    bottlenecks.push({
      type: 'LOW_PRO_UTILIZATION',
      severity: 'warning',
      metric: 'utilization_rate',
      value: proUtil.utilization_rate,
      threshold: ANALYTICS_CONFIG.LOW_UTILIZATION_THRESHOLD,
      description: 'Many pros are not getting assignments',
      recommendation: 'Review pro availability settings, improve job distribution, market to increase demand'
    });
  }
  
  if (proUtil.underutilized_pros > (proUtil.total_pros * 0.3)) {
    bottlenecks.push({
      type: 'UNEVEN_DISTRIBUTION',
      severity: 'warning',
      metric: 'underutilized_pros',
      value: proUtil.underutilized_pros,
      total_pros: proUtil.total_pros,
      description: 'Job distribution is heavily skewed toward certain pros',
      recommendation: 'Review matching criteria, ensure all pros are visible, address geographic imbalances'
    });
  }
  
  // Check service performance
  var svcPerf = getServicePerformanceMetrics(daysBack);
  
  if (svcPerf.low_performing_services > (svcPerf.total_services * 0.4)) {
    bottlenecks.push({
      type: 'LOW_SERVICE_ADOPTION',
      severity: 'info',
      metric: 'low_performing_services',
      value: svcPerf.low_performing_services,
      total_services: svcPerf.total_services,
      description: 'Many services have zero bookings',
      recommendation: 'Review service catalog, remove unused services, improve service descriptions, adjust pricing'
    });
  }
  
  return {
    period_days: daysBack,
    bottlenecks_found: bottlenecks.length,
    critical_issues: bottlenecks.filter(function(b) { return b.severity === 'critical'; }).length,
    warnings: bottlenecks.filter(function(b) { return b.severity === 'warning'; }).length,
    bottlenecks: bottlenecks
  };
}

/* ========================= COMPREHENSIVE INTELLIGENCE ========================= */

/**
 * Get comprehensive dispatch system intelligence
 * This is the main function to call for full system analysis
 */
function getDispatchIntelligence(options) {
  options = options || {};
  var daysBack = options.daysBack || ANALYTICS_CONFIG.MEDIUM_TERM;
  
  Logger.log('🧠 Generating Dispatch Intelligence Report...');
  Logger.log('📊 Analysis Period: Last ' + daysBack + ' days');
  
  var intelligence = {
    generated_at: new Date().toISOString(),
    period_days: daysBack,
    
    // Core operational metrics
    job_flow: getJobFlowMetrics(daysBack),
    pro_utilization: getProUtilizationMetrics(daysBack),
    service_performance: getServicePerformanceMetrics(daysBack),
    geographic_coverage: getGeographicCoverageMetrics(daysBack),
    customer_behavior: getCustomerBehaviorMetrics(daysBack),
    
    // Bottleneck detection
    bottlenecks: detectBottlenecks(daysBack),
    
    // Summary insights
    summary: generateSummaryInsights(daysBack)
  };
  
  Logger.log('✅ Intelligence Report Generated');
  Logger.log('📈 Total Jobs: ' + intelligence.job_flow.total_jobs);
  Logger.log('💰 Total Revenue: $' + intelligence.job_flow.total_revenue);
  Logger.log('👷 Active Pros: ' + intelligence.pro_utilization.active_pros);
  Logger.log('⚠️ Bottlenecks Found: ' + intelligence.bottlenecks.bottlenecks_found);
  
  return intelligence;
}

/**
 * Generate human-readable summary insights
 */
function generateSummaryInsights(daysBack) {
  var insights = [];
  
  var jobFlow = getJobFlowMetrics(daysBack);
  var proUtil = getProUtilizationMetrics(daysBack);
  var svcPerf = getServicePerformanceMetrics(daysBack);
  var geoCov = getGeographicCoverageMetrics(daysBack);
  var custBehav = getCustomerBehaviorMetrics(daysBack);
  
  // Job flow insights
  if (jobFlow.completion_rate > 0.8) {
    insights.push('✅ Strong job completion rate (' + Math.round(jobFlow.completion_rate * 100) + '%)');
  } else if (jobFlow.completion_rate < 0.6) {
    insights.push('⚠️ Low job completion rate (' + Math.round(jobFlow.completion_rate * 100) + '%) - investigate causes');
  }
  
  // Revenue insights
  if (jobFlow.total_revenue > 0) {
    insights.push('💰 Generated $' + jobFlow.total_revenue.toLocaleString() + ' in revenue');
  }
  
  // Pro utilization insights
  if (proUtil.utilization_rate > 0.7) {
    insights.push('👷 High pro engagement (' + Math.round(proUtil.utilization_rate * 100) + '% active)');
  } else if (proUtil.utilization_rate < 0.5) {
    insights.push('⚠️ Low pro utilization (' + Math.round(proUtil.utilization_rate * 100) + '%) - many idle pros');
  }
  
  // Service insights
  if (svcPerf.top_services.length > 0) {
    var topService = svcPerf.top_services[0];
    insights.push('🏆 Top service: "' + topService.name + '" ($' + topService.revenue + ' revenue)');
  }
  
  // Geographic insights
  if (geoCov.states_served > 5) {
    insights.push('🌎 Wide geographic reach (' + geoCov.states_served + ' states)');
  } else if (geoCov.states_served === 1) {
    insights.push('📍 Operating in single state - expansion opportunity');
  }
  
  // Customer insights
  if (custBehav.repeat_rate > 0.3) {
    insights.push('🔁 Strong customer retention (' + Math.round(custBehav.repeat_rate * 100) + '% repeat rate)');
  } else if (custBehav.repeat_rate < 0.15) {
    insights.push('⚠️ Low repeat customer rate - focus on customer satisfaction');
  }
  
  return insights;
}

/* ========================= AI ANALYSIS ENDPOINT ========================= */

/**
 * Generate AI-ready analysis payload
 * This formats all intelligence data for AI interpretation
 */
function generateAIAnalysisPayload(daysBack) {
  daysBack = daysBack || ANALYTICS_CONFIG.MEDIUM_TERM;
  
  var intelligence = getDispatchIntelligence({ daysBack: daysBack });
  
  // Format for AI consumption
  var payload = {
    analysis_request: {
      role: 'business_consultant',
      task: 'analyze_dispatch_operations',
      focus_areas: [
        'bottleneck_identification',
        'revenue_optimization',
        'resource_allocation',
        'growth_opportunities',
        'risk_assessment',
        'geographic_expansion',
        'automation_opportunities'
      ]
    },
    
    data: intelligence,
    
    questions: [
      'What are the most critical bottlenecks in our dispatch system right now?',
      'Where are we losing revenue or efficiency?',
      'Which geographic markets should we prioritize for expansion based on current data?',
      'How can we improve pro utilization and job distribution?',
      'What patterns indicate customer satisfaction issues?',
      'What is our biggest opportunity for growth in the next 30 days?',
      'Are there any geographic areas with high demand but low coverage that we should target?',
      'What automation or process improvements would have the highest ROI?'
    ]
  };
  
  return payload;
}

/**
 * Get OpenAI API credentials from Script Properties
 * Uses your existing OPENAI_API_KEY
 */
function getOpenAIAPIKey_() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty('OPENAI_API_KEY');
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured in Script Properties.');
  }
  
  return apiKey;
}

/**
 * Call OpenAI API to analyze dispatch intelligence
 * This is the bridge between data and actionable insights
 */
function analyzeWithAI(daysBack, focusArea) {
  daysBack = daysBack || ANALYTICS_CONFIG.MEDIUM_TERM;
  focusArea = focusArea || 'comprehensive';
  
  Logger.log('🤖 Requesting AI Analysis...');
  Logger.log('📊 Period: ' + daysBack + ' days | Focus: ' + focusArea);
  
  // Get intelligence data
  var payload = generateAIAnalysisPayload(daysBack);
  
  // Build AI prompt based on focus area
  var systemPrompt = buildSystemPrompt(focusArea);
  var userPrompt = buildUserPrompt(payload, focusArea);
  
  // Call OpenAI API
  var apiKey = getOpenAIAPIKey_();
  var url = 'https://api.openai.com/v1/chat/completions';
  
  var requestBody = {
    model: 'gpt-4-turbo-preview',
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ],
    max_tokens: 4096,
    temperature: 0.7
  };
  
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + apiKey
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };
  
  try {
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    
    if (responseCode !== 200) {
      throw new Error('OpenAI API error: ' + response.getContentText());
    }
    
    var result = JSON.parse(response.getContentText());
    
    // Extract AI analysis from response
    var analysis = result.choices[0].message.content;
    
    Logger.log('✅ AI Analysis Complete');
    Logger.log('📝 Analysis length: ' + analysis.length + ' characters');
    
    return {
      success: true,
      generated_at: new Date().toISOString(),
      period_days: daysBack,
      focus_area: focusArea,
      analysis: analysis,
      intelligence_data: payload.data,
      model: 'gpt-4-turbo-preview'
    };
    
  } catch(e) {
    Logger.log('❌ AI Analysis Failed: ' + e.toString());
    return {
      success: false,
      error: e.toString(),
      generated_at: new Date().toISOString()
    };
  }
}

/**
 * Build system prompt based on analysis focus area
 */
function buildSystemPrompt(focusArea) {
  var basePrompt = 'You are an expert business consultant specializing in dispatch operations, service businesses, and operational efficiency. ';
  basePrompt += 'Analyze the provided data and deliver clear, actionable insights. ';
  basePrompt += 'Focus on practical recommendations that can be implemented immediately. ';
  basePrompt += 'Be direct, data-driven, and specific. Avoid generic advice.';
  
  var focusSpecific = {
    'comprehensive': ' Provide a comprehensive analysis covering all aspects of the dispatch operation.',
    'bottlenecks': ' Focus specifically on identifying and prioritizing bottlenecks. Rank by severity and impact.',
    'revenue': ' Focus on revenue optimization opportunities and areas of revenue leakage.',
    'geographic': ' Focus on geographic expansion opportunities and market coverage gaps.',
    'pro_utilization': ' Focus on pro efficiency, utilization rates, and workload distribution.',
    'customer_satisfaction': ' Focus on customer behavior patterns and satisfaction indicators.',
    'automation': ' Focus on identifying processes that should be automated or improved with better systems.'
  };
  
  return basePrompt + (focusSpecific[focusArea] || focusSpecific['comprehensive']);
}

/**
 * Build user prompt with intelligence data
 */
function buildUserPrompt(payload, focusArea) {
  var prompt = 'I need you to analyze our dispatch system data and provide consulting-level insights.\n\n';
  
  prompt += '**ANALYSIS PERIOD:** Last ' + payload.data.period_days + ' days\n\n';
  
  prompt += '**CURRENT METRICS:**\n';
  prompt += '- Total Jobs: ' + payload.data.job_flow.total_jobs + '\n';
  prompt += '- Completed Jobs: ' + payload.data.job_flow.completed_jobs + ' (' + (payload.data.job_flow.completion_rate * 100) + '%)\n';
  prompt += '- Cancelled Jobs: ' + payload.data.job_flow.cancelled_jobs + ' (' + (payload.data.job_flow.cancellation_rate * 100) + '%)\n';
  prompt += '- Total Revenue: $' + payload.data.job_flow.total_revenue + '\n';
  prompt += '- Avg Revenue/Job: $' + payload.data.job_flow.avg_revenue_per_job + '\n';
  prompt += '- Avg Assignment Time: ' + payload.data.job_flow.avg_assignment_time_hours + ' hours\n\n';
  
  prompt += '**PRO WORKFORCE:**\n';
  prompt += '- Total Pros: ' + payload.data.pro_utilization.total_pros + '\n';
  prompt += '- Active Pros: ' + payload.data.pro_utilization.active_pros + ' (' + (payload.data.pro_utilization.utilization_rate * 100) + '%)\n';
  prompt += '- Avg Jobs/Pro: ' + payload.data.pro_utilization.avg_jobs_per_pro + '\n';
  prompt += '- Underutilized Pros: ' + payload.data.pro_utilization.underutilized_pros + '\n\n';
  
  prompt += '**GEOGRAPHIC COVERAGE:**\n';
  prompt += '- States Served: ' + payload.data.geographic_coverage.states_served + '\n';
  prompt += '- Cities Served: ' + payload.data.geographic_coverage.cities_served + '\n';
  prompt += '- ZIP Codes Served: ' + payload.data.geographic_coverage.zip_codes_served + '\n';
  if (payload.data.geographic_coverage.top_states.length > 0) {
    prompt += '- Top State: ' + payload.data.geographic_coverage.top_states[0].state + ' (' + payload.data.geographic_coverage.top_states[0].jobs + ' jobs)\n';
  }
  prompt += '\n';
  
  prompt += '**CUSTOMER BEHAVIOR:**\n';
  prompt += '- Total Customers: ' + payload.data.customer_behavior.total_customers + '\n';
  prompt += '- Repeat Customers: ' + payload.data.customer_behavior.repeat_customers + ' (' + (payload.data.customer_behavior.repeat_rate * 100) + '%)\n';
  prompt += '- Avg Customer LTV: $' + payload.data.customer_behavior.avg_lifetime_value + '\n\n';
  
  prompt += '**SERVICE PERFORMANCE:**\n';
  prompt += '- Total Services: ' + payload.data.service_performance.total_services + '\n';
  prompt += '- Services Revenue: $' + payload.data.service_performance.total_revenue + '\n';
  prompt += '- Low Performing Services: ' + payload.data.service_performance.low_performing_services + '\n';
  if (payload.data.service_performance.top_services.length > 0) {
    prompt += '- Top Service: ' + payload.data.service_performance.top_services[0].name + ' ($' + payload.data.service_performance.top_services[0].revenue + ')\n';
  }
  prompt += '\n';
  
  prompt += '**DETECTED BOTTLENECKS:**\n';
  if (payload.data.bottlenecks.bottlenecks_found === 0) {
    prompt += '- No critical bottlenecks detected\n\n';
  } else {
    prompt += '- Total Issues: ' + payload.data.bottlenecks.bottlenecks_found + '\n';
    prompt += '- Critical: ' + payload.data.bottlenecks.critical_issues + '\n';
    prompt += '- Warnings: ' + payload.data.bottlenecks.warnings + '\n';
    payload.data.bottlenecks.bottlenecks.forEach(function(b) {
      prompt += '  - [' + b.severity.toUpperCase() + '] ' + b.type + ': ' + b.description + '\n';
    });
    prompt += '\n';
  }
  
  prompt += '**SUMMARY INSIGHTS:**\n';
  payload.data.summary.forEach(function(insight) {
    prompt += '- ' + insight + '\n';
  });
  prompt += '\n';
  
  prompt += '**FULL DATA:**\n';
  prompt += JSON.stringify(payload.data, null, 2) + '\n\n';
  
  prompt += '**YOUR TASK:**\n';
  prompt += 'Based on this data, provide:\n';
  prompt += '1. **Executive Summary** - 2-3 sentence overview of system health\n';
  prompt += '2. **Critical Issues** - Top 3 problems ranked by severity and business impact\n';
  prompt += '3. **Opportunities** - Top 3 growth/optimization opportunities\n';
  prompt += '4. **Geographic Analysis** - Where to expand or improve coverage\n';
  prompt += '5. **Action Plan** - Specific next steps with priorities (implement this week, this month, this quarter)\n';
  prompt += '6. **Metrics to Watch** - Which KPIs need monitoring and why\n\n';
  
  prompt += 'Format your response in clear sections. Be specific with numbers and recommendations. ';
  prompt += 'If you see patterns that indicate systemic issues, call them out. ';
  prompt += 'Remember: we want to scale intelligently and automatically adapt to new areas without manual configuration.';
  
  return prompt;
}

/**
 * Quick analysis functions for specific focus areas
 */
function analyzeBottlenecks(daysBack) {
  return analyzeWithAI(daysBack || 7, 'bottlenecks');
}

function analyzeRevenue(daysBack) {
  return analyzeWithAI(daysBack || 30, 'revenue');
}

function analyzeGeographicExpansion(daysBack) {
  return analyzeWithAI(daysBack || 30, 'geographic');
}

function analyzeProUtilization(daysBack) {
  return analyzeWithAI(daysBack || 14, 'pro_utilization');
}

function analyzeCustomerSatisfaction(daysBack) {
  return analyzeWithAI(daysBack || 90, 'customer_satisfaction');
}

function analyzeAutomationOpportunities(daysBack) {
  return analyzeWithAI(daysBack || 30, 'automation');
}

/**
 * EXAMPLES: How to use Analytics + AI
 */
function exampleUsage() {
  // === BASIC METRICS (No AI) ===
  
  // Get 30-day intelligence report
  var report = getDispatchIntelligence({ daysBack: 30 });
  Logger.log('📊 30-Day Intelligence Report:');
  Logger.log(JSON.stringify(report, null, 2));
  
  // Get specific metrics
  var jobMetrics = getJobFlowMetrics(7); // Last 7 days
  Logger.log('📈 Job Flow (7 days):');
  Logger.log(JSON.stringify(jobMetrics, null, 2));
  
  var bottlenecks = detectBottlenecks(7);
  Logger.log('⚠️ Bottlenecks Found: ' + bottlenecks.bottlenecks_found);
  
  // === AI ANALYSIS (Uses OPENAI_API_KEY from Script Properties) ===
  
  // Comprehensive AI analysis
  var aiAnalysis = analyzeWithAI(30, 'comprehensive');
  if (aiAnalysis.success) {
    Logger.log('🤖 AI ANALYSIS:');
    Logger.log(aiAnalysis.analysis);
  } else {
    Logger.log('❌ AI Analysis Failed: ' + aiAnalysis.error);
  }
  
  // Focused analyses
  var bottleneckAnalysis = analyzeBottlenecks(7);
  var revenueAnalysis = analyzeRevenue(30);
  var geoAnalysis = analyzeGeographicExpansion(30);
  var proAnalysis = analyzeProUtilization(14);
  
  Logger.log('🎯 Bottleneck Analysis:', bottleneckAnalysis.analysis);
  Logger.log('💰 Revenue Analysis:', revenueAnalysis.analysis);
  Logger.log('🌎 Geographic Analysis:', geoAnalysis.analysis);
  Logger.log('👷 Pro Utilization Analysis:', proAnalysis.analysis);
}

/**
 * Web app endpoint - call this from frontend to get AI analysis
 * Add this as a web app deployment to make it accessible via HTTP
 */
function doGet(e) {
  var params = e.parameter;
  var daysBack = parseInt(params.days) || 30;
  var focusArea = params.focus || 'comprehensive';
  
  var result = analyzeWithAI(daysBack, focusArea);
  
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Setup function - run this once to verify OpenAI API key
 */
function setupOpenAIAPIKey() {
  var ui = SpreadsheetApp.getUi();
  
  var props = PropertiesService.getScriptProperties();
  var existingKey = props.getProperty('OPENAI_API_KEY');
  
  if (existingKey) {
    ui.alert('OpenAI API Key Already Configured', 
             'Key found: ' + existingKey.substring(0, 20) + '...', 
             ui.ButtonSet.OK);
    Logger.log('✅ OpenAI API key already configured');
    return;
  }
  
  var response = ui.prompt(
    'OpenAI API Configuration',
    'Enter your OpenAI API Key (from platform.openai.com):',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (response.getSelectedButton() !== ui.Button.OK) {
    ui.alert('Setup cancelled');
    return;
  }
  
  var apiKey = response.getResponseText().trim();
  
  if (!apiKey || !apiKey.startsWith('sk-')) {
    ui.alert('Error: Invalid OpenAI API Key format. Should start with "sk-"');
    return;
  }
  
  props.setProperty('OPENAI_API_KEY', apiKey);
  
  ui.alert('Success!', 'OpenAI API key configured. You can now use AI analysis functions.', ui.ButtonSet.OK);
  Logger.log('✅ OpenAI API key configured');
}
