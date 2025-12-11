import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * Validate admin session
 */
async function validateAdminSession(token) {
  if (!token) return false;
  
  // Try both token and session_id fields for compatibility
  let { data, error } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('session_id, expires_at, admin_email')
    .eq('session_id', token)
    .single();
  
  // Fallback: try 'token' field if session_id didn't match
  if (error || !data) {
    const fallback = await supabase
      .from('h2s_dispatch_admin_sessions')
      .select('session_id, expires_at, admin_email')
      .eq('token', token)
      .single();
    
    data = fallback.data;
    error = fallback.error;
  }
    
  if (error || !data) return false;
  if (new Date(data.expires_at) < new Date()) return false;
  
  return true;
}

async function analyzeBusinessWithAI(metrics, apiKey) {
  if (!apiKey) return null;

  const prompt = `You are analyzing a home services dispatch business. Provide a concise executive analysis based on these metrics:

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

WORKFORCE:
- Active Pros: ${metrics.workforce.active_pros}
- Utilization Rate: ${metrics.workforce.utilization_rate}%

GROWTH:
- Month-over-Month: ${metrics.growth.mom_growth}%
- Unique Customers: ${metrics.growth.unique_customers}
- Repeat Rate: ${metrics.growth.repeat_rate}%

Provide analysis in this format:
1. OPERATIONAL HEALTH: What's working well and what's broken
2. BOTTLENECKS: What's limiting growth right now
3. MARGIN ANALYSIS: Where money is being lost or left on table
4. CRITICAL FIXES: Top 3 things to fix before scaling
5. GROWTH OPPORTUNITIES: Where to focus expansion efforts

Be direct. No fluff. Focus on actionable insights.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a business intelligence analyst providing executive-level insights for a home services dispatch company.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      console.error('OpenAI API Error:', response.status, await response.text());
      return null;
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content || null;

  } catch (error) {
    console.error('AI Analysis Error:', error);
    return null;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Support both GET with Authorization header and POST with token in body
    let token;
    if (req.method === 'GET') {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'No authorization header' });
      }
      token = authHeader.split(' ')[1];
    } else {
      token = req.body?.token;
      if (!token) {
        return res.status(401).json({ error: 'No token provided' });
      }
    }
    
    const isValid = await validateAdminSession(token);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Fetch all necessary data in parallel with error handling
    const fetchWithRetry = async (tableName, retries = 2) => {
      for (let i = 0; i <= retries; i++) {
        try {
          const { data, error } = await supabase.from(tableName).select('*');
          if (error) throw error;
          return data || [];
        } catch (err) {
          console.error(`[${tableName}] Attempt ${i+1} failed:`, err.message);
          if (i === retries) return [];
          await new Promise(r => setTimeout(r, 500 * (i + 1))); // Exponential backoff
        }
      }
    };

    const [
      jobs,
      jobLines,
      services,
      prosDispatch,
      payouts,
      assignments
    ] = await Promise.all([
      fetchWithRetry('h2s_dispatch_jobs'),
      fetchWithRetry('h2s_dispatch_job_lines'),
      fetchWithRetry('h2s_dispatch_services'),
      fetchWithRetry('h2s_dispatch_pros'),
      fetchWithRetry('h2s_payouts_ledger'),
      fetchWithRetry('h2s_dispatch_job_assignments')
    ]);

    // Try to get pros from main h2s_pros table (better data quality)
    const { data: prosMain } = await supabase.from('h2s_pros').select('pro_id, name, email, phone');
    const pros = (prosMain && prosMain.length > 0) ? prosMain : prosDispatch;

    if (!jobs || jobs.length === 0) {
        console.error('[CRITICAL] No jobs found in database');
        // Return minimal metrics instead of failing completely
        return res.status(200).json({
          ok: true,
          revenue: { total: 0, cost: 0, margin: 0, avg_job_value: 0 },
          operations: { jobs_completed: 0, jobs_pending: 0, completion_rate: 0, avg_time_to_complete: 0, bottlenecks: [] },
          geography: { total_cities: 0, top_cities: [], understaffed_cities: [] },
          services: { top_services: [] },
          pricing: { byo: {jobs:0,revenue:0,margin:0}, base: {jobs:0,revenue:0,margin:0}, h2s: {jobs:0,revenue:0,margin:0} },
          capacity: { current_load: 0, max_capacity: 0, utilization_pct: 0, available_capacity: 0 },
          workforce: { total_pros: 0, active_pros: 0, utilization_rate: 0, top_performers: [] },
          growth: { mom_growth: 0, last_month_jobs: 0, this_month_jobs: 0, unique_customers: 0, repeat_rate: 0 },
          timestamp: new Date().toISOString(),
          error: 'No jobs in database'
        });
    }

    // Enrich jobs with pro names from assignments table
    jobs.forEach(job => {
      if (!job.assigned_pro_name) {
        const assignment = assignments.find(a => a.job_id === job.job_id);
        if (assignment && assignment.pro_id) {
          const pro = pros.find(p => p.pro_id === assignment.pro_id);
          // Use pro name from pros table, or from job metadata, or assignment metadata
          job.assigned_pro_name = pro ? pro.name : 
                                  job.metadata?.pro_name || 
                                  assignment.pro_name ||
                                  'Unknown Tech';
          job.assigned_pro_id = assignment.pro_id;
        }
      }
    });

    // --- REVENUE CALCULATION FROM METADATA ---
    let totalRevenue = 0;
    let totalCost = 0;
    const serviceMap = {};
    const tierMap = { 
      byo: { jobs: 0, revenue: 0, cost: 0 }, 
      base: { jobs: 0, revenue: 0, cost: 0 }, 
      h2s: { jobs: 0, revenue: 0, cost: 0 } 
    };
    
    jobs.forEach(job => {
      const items = job.metadata?.items_json || [];
      let jobRevenue = 0;
      let jobCost = Number(job.metadata?.estimated_payout || 0);
      
      items.forEach(item => {
        const lineTotal = item.line_total || item.unit_price || 0;
        jobRevenue += lineTotal;
        
        // Service tracking
        const serviceName = item.service_name || item.bundle_id || 'Unknown';
        if (!serviceMap[serviceName]) {
          serviceMap[serviceName] = { jobs: new Set(), revenue: 0, cost: 0 };
        }
        serviceMap[serviceName].jobs.add(job.job_id);
        serviceMap[serviceName].revenue += lineTotal;
      });
      
      totalRevenue += jobRevenue;
      totalCost += jobCost;
      
      // Distribute service costs proportionally
      items.forEach(item => {
        const lineTotal = item.line_total || item.unit_price || 0;
        const serviceName = item.service_name || item.bundle_id || 'Unknown';
        const itemCostShare = jobRevenue > 0 ? (lineTotal / jobRevenue) * jobCost : 0;
        if (serviceMap[serviceName]) {
          serviceMap[serviceName].cost += itemCostShare;
        }
      });
      
      // Tier detection and cost allocation
      const items_byo = items.filter(i => 
        i.metadata?.mount_provider === 'customer' || 
        i.metadata?.mount_source?.includes('Customer')
      );
      const items_h2s = items.filter(i => i.metadata?.mount_provider === 'h2s');
      const items_base = items.filter(i => 
        !i.metadata?.mount_provider || 
        (i.metadata?.mount_provider !== 'customer' && i.metadata?.mount_provider !== 'h2s')
      );
      
      const byo_revenue = items_byo.reduce((sum, i) => sum + (i.line_total || i.unit_price || 0), 0);
      const h2s_revenue = items_h2s.reduce((sum, i) => sum + (i.line_total || i.unit_price || 0), 0);
      const base_revenue = items_base.reduce((sum, i) => sum + (i.line_total || i.unit_price || 0), 0);
      
      // Allocate costs proportionally to revenue for each tier
      if (jobRevenue > 0) {
        tierMap.byo.revenue += byo_revenue;
        tierMap.byo.cost += (byo_revenue / jobRevenue) * jobCost;
        
        tierMap.h2s.revenue += h2s_revenue;
        tierMap.h2s.cost += (h2s_revenue / jobRevenue) * jobCost;
        
        tierMap.base.revenue += base_revenue;
        tierMap.base.cost += (base_revenue / jobRevenue) * jobCost;
      }
      
      // Count tier jobs (assign to dominant tier)
      const dominant_tier = byo_revenue > h2s_revenue && byo_revenue > base_revenue ? 'byo' :
                           h2s_revenue > base_revenue ? 'h2s' : 'base';
      tierMap[dominant_tier].jobs++;
    });
    
    const margin = totalRevenue > 0 ? Number(((totalRevenue - totalCost) / totalRevenue * 100).toFixed(1)) : 0;
    const avgJobValue = jobs.length > 0 ? Math.round(totalRevenue / jobs.length) : 0;
    
    // Calculate tier margins with actual cost data
    Object.keys(tierMap).forEach(tier => {
      const tierRev = tierMap[tier].revenue;
      const tierCost = tierMap[tier].cost;
      tierMap[tier].margin = tierRev > 0 ? Number(((tierRev - tierCost) / tierRev * 100).toFixed(1)) : 0;
    });
    
    // Format top services
    const topServices = Object.entries(serviceMap)
      .map(([name, data]) => {
        const svcRev = data.revenue;
        const svcCost = data.cost;
        return {
          name,
          jobs: data.jobs.size,
          revenue: Math.round(svcRev),
          margin: svcRev > 0 ? Number(((svcRev - svcCost) / svcRev * 100).toFixed(1)) : 0
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // --- METRICS CALCULATION ---

    // Filter completed jobs
    const completedJobs = jobs.filter(j => j.status === 'completed');
    const completedJobIds = new Set(completedJobs.map(j => j.job_id));
    const completedJobLines = jobLines.filter(l => completedJobIds.has(l.job_id));

    // (Revenue already calculated above from metadata.items_json)

    // Operational Efficiency
    const jobsPending = jobs.filter(j => ['assigned', 'offered', 'pending', 'accepted'].includes(j.status)).length;
    const completionRate = jobs.length > 0 ? (completedJobs.length / jobs.length * 100) : 0;

    // Avg Time to Complete
    let totalDays = 0;
    let jobsWithDates = 0;
    completedJobs.forEach(j => {
      if (j.created_at && j.updated_at) {
        const created = new Date(j.created_at);
        const completed = new Date(j.updated_at);
        const days = (completed - created) / (1000 * 60 * 60 * 24);
        if (days >= 0 && days < 365) {
          totalDays += days;
          jobsWithDates++;
        }
      }
    });
    const avgTimeToComplete = jobsWithDates > 0 ? totalDays / jobsWithDates : 0;

    // Geographic Performance
    const citiesMap = {};
    jobs.forEach(j => {
      const city = String(j.service_city || 'Unknown').toLowerCase().trim();
      if (!citiesMap[city]) {
        citiesMap[city] = { name: city, jobs: 0, revenue: 0, cost: 0 };
      }
      citiesMap[city].jobs++;
      
      // Calculate revenue from metadata.items_json
      const items = j.metadata?.items_json || [];
      items.forEach(item => {
        const itemRevenue = Number(item.line_total || item.unit_price || 0);
        const itemCost = Number(item.line_total || item.unit_price || 0) * 0.35; // 35% cost, 65% margin
        citiesMap[city].revenue += itemRevenue;
        citiesMap[city].cost += itemCost;
      });
    });

    const cities = Object.values(citiesMap).map(c => {
      const margin = c.revenue > 0 ? ((c.revenue - c.cost) / c.revenue * 100) : 0;
      const avgVal = c.jobs > 0 ? c.revenue / c.jobs : 0;
      const prosInCity = pros.filter(p => String(p.home_city || '').trim() === c.name).length;
      return {
        name: c.name,
        jobs: c.jobs,
        revenue: Math.round(c.revenue),
        margin: Math.round(margin * 10) / 10,
        avg_job_value: Math.round(avgVal),
        pro_coverage: prosInCity
      };
    }).sort((a, b) => b.revenue - a.revenue);

    // Workforce Analysis
    const activePros = pros.filter(p => p.status === 'active').length;
    let totalMaxCapacity = 0;
    pros.forEach(p => {
        if(p.status === 'active') totalMaxCapacity += Number(p.max_jobs_per_day || 3);
    });
    const utilizationRate = totalMaxCapacity > 0 ? (jobsPending / totalMaxCapacity * 100) : 0;

    // Growth Metrics
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const lastMonthJobs = completedJobs.filter(j => {
        const d = new Date(j.created_at);
        return d >= lastMonth && d < thisMonth;
    }).length;

    const thisMonthJobs = completedJobs.filter(j => {
        const d = new Date(j.created_at);
        return d >= thisMonth;
    }).length;

    const momGrowth = lastMonthJobs > 0 ? ((thisMonthJobs - lastMonthJobs) / lastMonthJobs * 100) : 0;

    // Unique customers and repeat rate
    const customerIds = new Set();
    const customerJobCount = {};
    completedJobs.forEach(j => {
      if (j.customer_id) {
        customerIds.add(j.customer_id);
        customerJobCount[j.customer_id] = (customerJobCount[j.customer_id] || 0) + 1;
      }
    });
    const repeatCustomers = Object.values(customerJobCount).filter(c => c > 1).length;
    const repeatRate = customerIds.size > 0 ? (repeatCustomers / customerIds.size * 100) : 0;

    // Service Performance (already calculated above from metadata.items_json)
    const servicePerformance = topServices;

    // Pricing Tier Analysis (ONLY BYO and H2S Premium)
    const pricingTiers = {
      byo: {
        jobs: tierMap.byo.jobs,
        revenue: Math.round(tierMap.byo.revenue),
        margin: tierMap.byo.margin
      },
      h2s: {
        jobs: tierMap.h2s.jobs,
        revenue: Math.round(tierMap.h2s.revenue),
        margin: tierMap.h2s.margin
      }
    };

    // Top Performing Pros
    const proEarnings = {};
    
    // Build a pro_id -> name mapping from assignments and pros tables
    const proNameMap = {};
    assignments.forEach(assign => {
      if (assign.pro_id && !proNameMap[assign.pro_id]) {
        // Try to find in pros table
        const pro = pros.find(p => p.pro_id === assign.pro_id);
        if (pro && pro.name) {
          proNameMap[assign.pro_id] = pro.name;
        }
      }
    });
    
    console.log('[TOP PERFORMERS] Pro name map:', proNameMap);
    
    // Primary source: h2s_dispatch_job_lines (calc_pro_payout_total)
    let hasLineData = false;
    completedJobLines.forEach(line => {
      const job = jobs.find(j => j.job_id === line.job_id);
      if (job && job.assigned_pro_id && line.calc_pro_payout_total && line.calc_pro_payout_total > 0) {
        hasLineData = true;
        if (!proEarnings[job.assigned_pro_id]) {
          proEarnings[job.assigned_pro_id] = { earnings: 0, jobs: 0 };
        }
        proEarnings[job.assigned_pro_id].earnings += Number(line.calc_pro_payout_total || 0);
        proEarnings[job.assigned_pro_id].jobs++;
      }
    });
    
    // Fallback source: Use metadata.estimated_payout from completed jobs if job_lines has no payout data
    if (!hasLineData) {
      console.log('[FALLBACK] No payout data in job_lines, calculating from job metadata...');
      completedJobs.forEach(job => {
        if (job.assigned_pro_id && job.metadata?.estimated_payout) {
          if (!proEarnings[job.assigned_pro_id]) {
            proEarnings[job.assigned_pro_id] = { earnings: 0, jobs: 0 };
          }
          proEarnings[job.assigned_pro_id].earnings += Number(job.metadata.estimated_payout || 0);
          proEarnings[job.assigned_pro_id].jobs++;
        }
      });
      console.log(`[FALLBACK] Calculated ${Object.keys(proEarnings).length} pros from metadata`);
    }
    
    const topPerformers = Object.entries(proEarnings)
      .map(([proId, data]) => {
        // Get name from our mapping, fallback to searching pros table, then to pro_id
        let name = proNameMap[proId];
        if (!name) {
          const pro = pros.find(p => p.pro_id === proId);
          name = pro?.name || proId;
        }
        return {
          name: name,
          jobs: data.jobs,
          earnings: Math.round(data.earnings),
          avg_per_job: Math.round(data.earnings / data.jobs)
        };
      })
      .sort((a, b) => b.earnings - a.earnings)
      .slice(0, 10);

    // Capacity Analysis
    const capacityMetrics = {
      current_load: jobsPending,
      max_capacity: totalMaxCapacity,
      utilization_pct: Math.round(utilizationRate * 10) / 10,
      available_capacity: Math.max(0, totalMaxCapacity - jobsPending)
    };

    // Bottlenecks (Jobs pending > 48h)
    const bottlenecks = jobs
      .filter(j => ['new', 'pending', 'assigned'].includes(j.status))
      .filter(j => {
        const created = new Date(j.created_at);
        const diffHours = (now - created) / (1000 * 60 * 60);
        return diffHours > 48;
      })
      .map(j => ({
        job_id: j.job_id,
        status: j.status,
        hours_pending: Math.round((now - new Date(j.created_at)) / (1000 * 60 * 60)),
        service: j.service_name
      }));

    // Response Object
    const metrics = {
      revenue: {
        total: Math.round(totalRevenue),
        cost: Math.round(totalCost),
        margin: margin,
        avg_job_value: avgJobValue
      },
      operations: {
        jobs_completed: completedJobs.length,
        jobs_pending: jobsPending,
        completion_rate: Math.round(completionRate * 10) / 10,
        avg_time_to_complete: Math.round(avgTimeToComplete * 10) / 10,
        bottlenecks: bottlenecks
      },
      geography: {
        total_cities: cities.length,
        top_cities: cities.slice(0, 10),
        understaffed_cities: cities.filter(c => c.jobs > 10 && c.pro_coverage < 2).map(c => c.name)
      },
      services: {
        top_services: servicePerformance
      },
      pricing: pricingTiers,
      capacity: capacityMetrics,
      workforce: {
        total_pros: pros.length,
        active_pros: activePros,
        utilization_rate: Math.round(utilizationRate * 10) / 10,
        top_performers: topPerformers
      },
      growth: {
        mom_growth: Math.round(momGrowth * 10) / 10,
        last_month_jobs: lastMonthJobs,
        this_month_jobs: thisMonthJobs,
        unique_customers: customerIds.size,
        repeat_rate: Math.round(repeatRate * 10) / 10
      },
      timestamp: new Date().toISOString()
    };

    // --- AI ANALYSIS ---
    // Check if analysis is requested via query param ?analyze=true
    // And if OPENAI_API_KEY is available in env
    let aiAnalysis = null;
    if (req.query.analyze === 'true' && process.env.OPENAI_API_KEY) {
        aiAnalysis = await analyzeBusinessWithAI(metrics, process.env.OPENAI_API_KEY);
    }

    return res.status(200).json({
        ok: true,
        ...metrics,
        ai_analysis: aiAnalysis
    });

  } catch (error) {
    console.error('Error in business intelligence API:', error);
    return res.status(500).json({ error: error.message });
  }
}
