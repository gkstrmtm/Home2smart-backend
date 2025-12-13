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
 * Calculate Revenue Metrics from Jobs
 * Parses line_items_json and metadata to extract real revenue data
 */
export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Fetch all jobs with metadata
    const { data: jobs, error } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*');
    
    if (error) {
      console.error('Revenue calc - jobs fetch error:', error);
      return res.status(500).json({ ok: false, error: 'Database query failed' });
    }

    // Calculate totals
    let totalRevenue = 0;
    let totalCost = 0;
    let completedJobs = 0;
    let thisMonthRevenue = 0;
    let lastMonthRevenue = 0;
    
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    
    // Service breakdown
    const serviceMap = {};
    
    // Pricing tier breakdown
    const tierMap = {
      byo: { jobs: 0, revenue: 0 },
      base: { jobs: 0, revenue: 0 },
      h2s: { jobs: 0, revenue: 0 }
    };
    
    jobs.forEach(job => {
      const jobDate = new Date(job.created_at);
      
      // Extract revenue from metadata.items_json
      let jobRevenue = 0;
      const items = job.metadata?.items_json || [];
      
      items.forEach(item => {
        const lineTotal = item.line_total || item.unit_price || 0;
        jobRevenue += lineTotal;
        
        // Detect pricing tier
        const metadata = item.metadata || {};
        const isBYO = metadata.mount_provider === 'customer' || 
                      metadata.mount_source === 'Customer Provided' ||
                      metadata.mount_source?.includes('Customer');
        
        if (isBYO) {
          tierMap.byo.revenue += lineTotal;
        } else if (metadata.mount_provider === 'h2s') {
          tierMap.h2s.revenue += lineTotal;
        } else {
          tierMap.base.revenue += lineTotal;
        }
        
        // Service tracking
        const serviceName = item.service_name || item.bundle_id || 'Unknown';
        if (!serviceMap[serviceName]) {
          serviceMap[serviceName] = { jobs: 0, revenue: 0, count: 0 };
        }
        serviceMap[serviceName].revenue += lineTotal;
        serviceMap[serviceName].count++;
      });
      
      // Count tier jobs
      const jobTier = items.some(i => 
        i.metadata?.mount_provider === 'customer' || 
        i.metadata?.mount_source?.includes('Customer')
      ) ? 'byo' : (items.some(i => i.metadata?.mount_provider === 'h2s') ? 'h2s' : 'base');
      
      tierMap[jobTier].jobs++;
      
      totalRevenue += jobRevenue;
      totalCost += job.metadata?.estimated_payout || 0;
      
      if (job.status === 'completed') completedJobs++;
      
      // Service job count
      items.forEach(item => {
        const serviceName = item.service_name || item.bundle_id || 'Unknown';
        if (serviceMap[serviceName]) {
          serviceMap[serviceName].jobs = (serviceMap[serviceName].jobs || 0) + 1;
        }
      });
      
      // Time-based tracking
      if (jobDate >= thisMonthStart) {
        thisMonthRevenue += jobRevenue;
      }
      if (jobDate >= lastMonthStart && jobDate <= lastMonthEnd) {
        lastMonthRevenue += jobRevenue;
      }
    });
    
    // Calculate metrics
    const margin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100).toFixed(1) : 0;
    const avgJobValue = jobs.length > 0 ? Math.round(totalRevenue / jobs.length) : 0;
    const growth = lastMonthRevenue > 0 ? (((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100).toFixed(1) : 0;
    
    // Format services
    const topServices = Object.entries(serviceMap)
      .map(([name, data]) => ({
        name,
        jobs: data.jobs || 0,
        revenue: data.revenue,
        margin: totalRevenue > 0 ? ((data.revenue - (totalCost * (data.revenue / totalRevenue))) / data.revenue * 100).toFixed(1) : 0
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
    
    // Format pricing tiers
    Object.keys(tierMap).forEach(tier => {
      const tierData = tierMap[tier];
      tierData.margin = tierData.revenue > 0 ? 
        ((tierData.revenue - (totalCost * (tierData.revenue / totalRevenue))) / tierData.revenue * 100).toFixed(1) : 0;
    });

    return res.status(200).json({
      ok: true,
      revenue: {
        total: Math.round(totalRevenue),
        this_month: Math.round(thisMonthRevenue),
        last_month: Math.round(lastMonthRevenue),
        cost: Math.round(totalCost),
        margin: Number(margin),
        avg_job_value: avgJobValue,
        growth: Number(growth)
      },
      services: {
        top_services: topServices,
        total_categories: Object.keys(serviceMap).length
      },
      pricing: tierMap,
      jobs_analyzed: jobs.length,
      completed_jobs: completedJobs
    });

  } catch (err) {
    console.error('Revenue calculation error:', err);
    return res.status(500).json({
      ok: false,
      error: 'Server error',
      details: err.message
    });
  }
}
