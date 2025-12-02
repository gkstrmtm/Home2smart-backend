/**
 * Quick diagnostic - Check h2s_orders table and create test data if needed
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // Use service role to bypass RLS
);

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Check h2s_orders
    const { data: orders, error: ordersError, count: ordersCount } = await supabase
      .from('h2s_orders')
      .select('*', { count: 'exact' })
      .limit(10);

    // Check h2s_dispatch_jobs
    const { data: jobs, error: jobsError, count: jobsCount } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*', { count: 'exact' })
      .limit(10);

    // Check h2s_pros
    const { data: pros, error: prosError, count: prosCount } = await supabase
      .from('h2s_pros')
      .select('pro_id, name, email, status, is_active, geo_lat, geo_lng', { count: 'exact' })
      .limit(10);

    return res.status(200).json({
      ok: true,
      database_status: {
        h2s_orders: {
          total: ordersCount,
          sample: orders?.slice(0, 3) || [],
          error: ordersError?.message
        },
        h2s_dispatch_jobs: {
          total: jobsCount,
          sample: jobs?.slice(0, 3) || [],
          error: jobsError?.message
        },
        h2s_pros: {
          total: prosCount,
          sample: pros?.slice(0, 3) || [],
          error: prosError?.message
        }
      }
    });

  } catch (error) {
    console.error('[diagnostic] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
