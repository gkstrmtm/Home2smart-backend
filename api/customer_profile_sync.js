import { createClient } from '@supabase/supabase-js';

/**
 * CUSTOMER PROFILE SYNC ENDPOINT
 * 
 * Automatically updates customer profiles based on order data
 * Call this after order completion or via webhook
 * 
 * Purpose: Build rich customer profiles for personalized marketing
 * 
 * IMPORTANT: This updates h2s_customer_profiles ONLY (marketing data)
 * Does NOT modify h2s_users (rewards/referrals managed by Shopbackend.js)
 * 
 * Data Sources:
 * - Equipment preferences: h2s_orders.metadata_json (TV sizes, wall types)
 * - Purchase history: h2s_orders (order count, spending)
 * - Marketing tier: Calculated from order count (new/repeat/vip)
 * 
 * Separate from:
 * - Rewards points: h2s_users.points_balance (handled by stripe_webhook)
 * - Referral codes: h2s_users.referral_code (handled by Shopbackend.js)
 * - Rewards tier: h2s_users.tier (bronze/silver/gold)
 */

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validate environment
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(500).json({ ok: false, error: 'Server configuration error' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  try {
    const { email, order_id, mode } = req.method === 'POST' ? req.body : req.query;

    // Mode: 'single' (one order) or 'all' (sync all customers)
    if (mode === 'all') {
      return await syncAllCustomers(supabase, res);
    }

    if (!email && !order_id) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Provide email or order_id to sync' 
      });
    }

    // Get customer email from order if order_id provided
    let customerEmail = email;
    if (order_id && !email) {
      const { data: orders } = await supabase
        .from('h2s_orders')
        .select('email, customer_email')
        .eq('order_id', order_id)
        .limit(1);
      
      if (orders && orders.length > 0) {
        customerEmail = orders[0].email || orders[0].customer_email;
      }
    }

    if (!customerEmail) {
      return res.status(400).json({ ok: false, error: 'Customer email not found' });
    }

    // Sync this customer's profile
    const result = await syncCustomerProfile(supabase, customerEmail);

    return res.status(200).json({
      ok: true,
      customer: result
    });

  } catch (error) {
    console.error('[Customer Profile Sync] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Profile sync failed'
    });
  }
}

/**
 * Sync a single customer's profile from their order history
 * 
 * NOTE: This ONLY updates h2s_customer_profiles (marketing data)
 * Does NOT touch h2s_users (rewards/referrals - managed separately)
 */
async function syncCustomerProfile(supabase, email) {
  console.log(`[Profile Sync] Syncing customer: ${email}`);

  // Get all orders for this customer (both summary and line items)
  const { data: orders, error: ordersError } = await supabase
    .from('h2s_orders')
    .select('*')
    .or(`email.eq.${email},customer_email.eq.${email}`)
    .order('created_at', { ascending: true });

  if (ordersError) {
    throw new Error(`Failed to fetch orders: ${ordersError.message}`);
  }

  if (!orders || orders.length === 0) {
    console.log(`[Profile Sync] No orders found for ${email}`);
    return null;
  }

  console.log(`[Profile Sync] Found ${orders.length} order records (syncing marketing profile only, not rewards)`);

  // Extract metadata from orders
  const tvSizes = new Set();
  const wallTypes = new Set();
  const mountTypes = new Set();
  const serviceTypes = new Set();
  let teamJobCount = 0;
  let soloJobCount = 0;
  let totalSpent = 0;
  let firstOrderDate = null;
  let lastOrderDate = null;
  let customerName = null;
  let customerPhone = null;
  let primaryAddress = null;
  let primaryCity = null;
  let primaryState = null;
  let primaryZip = null;

  // Process all orders
  orders.forEach(order => {
    // Summary rows have totals
    if (order.line_type === 'summary' || !order.line_type) {
      const orderTotal = parseFloat(order.total || order.subtotal || 0);
      if (orderTotal > 0) totalSpent += orderTotal;
      
      // Track first/last order dates
      const orderDate = new Date(order.created_at);
      if (!firstOrderDate || orderDate < firstOrderDate) {
        firstOrderDate = orderDate;
      }
      if (!lastOrderDate || orderDate > lastOrderDate) {
        lastOrderDate = orderDate;
      }
    }

    // Extract customer info (use most recent)
    if (order.name || order.customer_name) {
      customerName = order.name || order.customer_name;
    }
    if (order.phone || order.customer_phone) {
      customerPhone = order.phone || order.customer_phone;
    }
    if (order.service_address) {
      primaryAddress = order.service_address;
      primaryCity = order.service_city;
      primaryState = order.service_state;
      primaryZip = order.service_zip;
    }

    // Extract equipment preferences
    if (order.tv_size) {
      tvSizes.add(order.tv_size);
    }
    if (order.wall_type) {
      wallTypes.add(order.wall_type);
    }
    if (order.mount_type) {
      mountTypes.add(order.mount_type);
    }

    // Parse metadata_json for additional details
    if (order.metadata_json) {
      try {
        const metadata = typeof order.metadata_json === 'string' 
          ? JSON.parse(order.metadata_json) 
          : order.metadata_json;
        
        if (metadata.tv_size) tvSizes.add(metadata.tv_size);
        if (metadata.wall_type) wallTypes.add(metadata.wall_type);
        if (metadata.mount_type) mountTypes.add(metadata.mount_type);
      } catch (e) {
        // Skip invalid JSON
      }
    }

    // Track service types
    if (order.service_id) {
      serviceTypes.add(order.service_id);
    }
    if (order.bundle_id) {
      if (order.bundle_id.includes('tv')) serviceTypes.add('tv_mounting');
      if (order.bundle_id.includes('cam')) serviceTypes.add('security_cameras');
    }

    // Count team vs solo jobs
    if (order.requires_team || order.min_team_size > 1) {
      teamJobCount++;
    } else if (order.service_id || order.bundle_id) {
      soloJobCount++;
    }
  });

  // Determine customer tier
  const totalOrders = orders.filter(o => o.line_type === 'summary' || !o.line_type).length;
  let customerTier = 'new';
  if (totalOrders >= 5) customerTier = 'vip';
  else if (totalOrders >= 2) customerTier = 'repeat';

  // Build profile object
  const profileData = {
    email: email.toLowerCase(),
    name: customerName,
    phone: customerPhone,
    primary_address: primaryAddress,
    primary_city: primaryCity,
    primary_state: primaryState,
    primary_zip: primaryZip,
    tv_sizes: Array.from(tvSizes),
    wall_types: Array.from(wallTypes),
    mount_preferences: Array.from(mountTypes),
    preferred_service_types: Array.from(serviceTypes),
    team_job_history: teamJobCount,
    solo_job_history: soloJobCount,
    total_orders: totalOrders,
    total_spent: totalSpent,
    first_order_date: firstOrderDate ? firstOrderDate.toISOString() : null,
    last_order_date: lastOrderDate ? lastOrderDate.toISOString() : null,
    customer_tier: customerTier,
    updated_at: new Date().toISOString()
  };

  console.log(`[Profile Sync] Profile data:`, {
    email,
    totalOrders,
    totalSpent,
    tier: customerTier,
    tvSizes: Array.from(tvSizes),
    serviceTypes: Array.from(serviceTypes)
  });

  // Upsert profile (update if exists, insert if new)
  const { data: profile, error: upsertError } = await supabase
    .from('h2s_customer_profiles')
    .upsert(profileData, { 
      onConflict: 'email',
      returning: 'representation'
    })
    .select()
    .single();

  if (upsertError) {
    throw new Error(`Failed to upsert profile: ${upsertError.message}`);
  }

  console.log(`[Profile Sync] ✅ Profile synced for ${email}`);
  return profile;
}

/**
 * Sync all customers (run periodically or on-demand)
 */
async function syncAllCustomers(supabase, res) {
  console.log('[Profile Sync] Syncing ALL customers...');

  // Get distinct customer emails from orders
  const { data: customers, error } = await supabase
    .from('h2s_orders')
    .select('email, customer_email')
    .not('email', 'is', null);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  // Deduplicate emails
  const emailSet = new Set();
  customers.forEach(c => {
    if (c.email) emailSet.add(c.email.toLowerCase());
    if (c.customer_email) emailSet.add(c.customer_email.toLowerCase());
  });

  const emails = Array.from(emailSet);
  console.log(`[Profile Sync] Found ${emails.length} unique customers`);

  // Sync each customer
  const results = [];
  const errors = [];

  for (const email of emails) {
    try {
      const profile = await syncCustomerProfile(supabase, email);
      results.push({ email, success: true, profile });
    } catch (err) {
      console.error(`[Profile Sync] Failed for ${email}:`, err.message);
      errors.push({ email, error: err.message });
    }
  }

  return res.status(200).json({
    ok: true,
    total_customers: emails.length,
    synced: results.length,
    failed: errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined
  });
}
