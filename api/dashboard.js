import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { fn, limit } = req.query;

  try {
    if (fn === 'stats') {
      return await getStats(res);
    } else if (fn === 'revenue') {
      return await getRevenue(res);
    } else if (fn === 'cohorts') {
      return await getCohorts(res);
    } else if (fn === 'meta_pixel_events') {
      return await getMetaPixelEvents(res);
    } else if (fn === 'funnel') {
      return await getFunnel(res);
    } else if (fn === 'users') {
      return await getUsers(res, limit);
    } else {
      return res.status(400).json({ error: 'Invalid function' });
    }
  } catch (error) {
    console.error('[Dashboard] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function getStats(res) {
  // Count unique sessions and total events from analytics_events
  // Note: count() is faster than fetching all data
  const { count: total_events, error: eventsError } = await supabase
    .from('analytics_events')
    .select('*', { count: 'exact', head: true });

  if (eventsError) throw eventsError;

  // For unique sessions, we might need a different approach if the table is huge.
  // But for now, let's try a distinct query or just estimate.
  // Supabase doesn't support distinct count easily without RPC.
  // We'll use a simplified approach: count distinct session_ids in the last 30 days?
  // Or just return total_events for now if sessions is hard.
  
  // Let's try to get unique sessions via RPC if available, or just fetch session_ids (might be heavy)
  // Alternatively, we can just return total_events and 0 for sessions if we can't compute it cheaply.
  
  // Let's try to fetch distinct session_ids for the last 24h to keep it light?
  // Or just use total_events.
  
  return res.json({
    unique_sessions: 0, // Placeholder, requires RPC or heavy query
    total_events: total_events || 0
  });
}

async function getRevenue(res) {
  const { data: orders, error } = await supabase
    .from('h2s_orders')
    .select('total_amount, created_at');

  if (error) throw error;

  let total_revenue = 0;
  let revenue_by_day = {};

  orders.forEach(order => {
    const amount = parseFloat(order.total_amount || 0);
    total_revenue += amount;
    
    const day = new Date(order.created_at).toISOString().split('T')[0];
    revenue_by_day[day] = (revenue_by_day[day] || 0) + amount;
  });

  const total_orders = orders.length;
  const average_order_value = total_orders > 0 ? total_revenue / total_orders : 0;

  return res.json({
    total_revenue,
    total_orders,
    average_order_value,
    revenue_by_day
  });
}

async function getCohorts(res) {
  // Count unique emails in orders
  const { data: orders, error } = await supabase
    .from('h2s_orders')
    .select('customer_email');

  if (error) throw error;

  const uniqueCustomers = new Set(orders.map(o => o.customer_email).filter(Boolean));

  return res.json({
    total_users: uniqueCustomers.size,
    user_cohorts: {
      customer: uniqueCustomers.size
    }
  });
}

async function getMetaPixelEvents(res) {
  // Aggregate analytics_events
  const { data: events, error } = await supabase
    .from('analytics_events')
    .select('event_name, session_id, user_email, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(1000); // Limit to recent 1000 for performance

  if (error) throw error;

  const summary = {
    total_events: events.length, // This is just of the sample
    unique_sessions: new Set(events.map(e => e.session_id)).size,
    unique_users: new Set(events.map(e => e.user_email).filter(Boolean)).size,
    total_value: 0,
    by_event_type: {},
    by_page_type: {},
    by_utm_source: {}
  };

  events.forEach(e => {
    // Event Type
    if (!summary.by_event_type[e.event_name]) {
      summary.by_event_type[e.event_name] = { count: 0 };
    }
    summary.by_event_type[e.event_name].count++;

    // Value (Purchase)
    if (e.event_name === 'Purchase' && e.payload?.value) {
      summary.total_value += parseFloat(e.payload.value);
    }

    // Page Type (from payload)
    // Assuming payload has page_type or we infer from URL?
    // The payload structure depends on what bundles-app.js sends.
    // It sends: event, timestamp, session_id, user_email, url, ...data
    // We might need to parse URL or look for page_type in payload
    const pageType = e.payload?.page_type || 'unknown';
    if (!summary.by_page_type[pageType]) {
      summary.by_page_type[pageType] = { count: 0 };
    }
    summary.by_page_type[pageType].count++;

    // UTM Source (from URL or payload)
    // We'd need to parse URL parameters from e.url
    try {
      const url = new URL(e.url || 'http://localhost');
      const source = url.searchParams.get('utm_source') || 'direct';
      if (!summary.by_utm_source[source]) {
        summary.by_utm_source[source] = { count: 0 };
      }
      summary.by_utm_source[source].count++;
    } catch (err) {
      // ignore
    }
  });

  return res.json({ summary });
}

async function getFunnel(res) {
  // Simplified funnel based on event names
  // Visitor (PageView) -> Browser (ViewContent) -> Engaged (?) -> Lead (Lead) -> Customer (Purchase)
  
  // We'll use the same recent events sample or count queries
  // For speed, let's do count queries for each event type
  
  const [
    { count: visitors },
    { count: browsers },
    { count: leads },
    { count: customers }
  ] = await Promise.all([
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }).eq('event_name', 'PageView'),
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }).eq('event_name', 'ViewContent'),
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }).eq('event_name', 'Lead'),
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }).eq('event_name', 'Purchase')
  ]);

  const stage_distribution = {
    visitor: visitors || 0,
    browser: browsers || 0,
    engaged: browsers || 0, // Approximation
    lead: leads || 0,
    customer: customers || 0
  };

  const totals = {
    leads: leads || 0,
    customers: customers || 0
  };

  const conversion_rates = {
    visitor_to_browser: visitors ? Math.round((browsers / visitors) * 100) + '%' : '0%',
    browser_to_engaged: '100%',
    engaged_to_lead: browsers ? Math.round((leads / browsers) * 100) + '%' : '0%',
    lead_to_customer: leads ? Math.round((customers / leads) * 100) + '%' : '0%'
  };

  return res.json({
    stage_distribution,
    totals,
    conversion_rates
  });
}

async function getUsers(res, limit = 10) {
  // Get top customers from orders
  const { data: orders, error } = await supabase
    .from('h2s_orders')
    .select('customer_email, total_amount, created_at')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const userMap = {};

  orders.forEach(order => {
    const email = order.customer_email;
    if (!email) return;

    if (!userMap[email]) {
      userMap[email] = {
        Email: email,
        Total_Orders: 0,
        Lifetime_Revenue: 0,
        Last_Purchase_Date: order.created_at,
        Current_Funnel_Stage: 'customer'
      };
    }

    userMap[email].Total_Orders++;
    userMap[email].Lifetime_Revenue += parseFloat(order.total_amount || 0);
    // Keep latest date
    if (new Date(order.created_at) > new Date(userMap[email].Last_Purchase_Date)) {
      userMap[email].Last_Purchase_Date = order.created_at;
    }
  });

  const top_users = Object.values(userMap)
    .sort((a, b) => b.Lifetime_Revenue - a.Lifetime_Revenue)
    .slice(0, parseInt(limit));

  return res.json({ top_users });
}
