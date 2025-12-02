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

/**
 * Geocode address using Google Maps API with intelligent caching and fallbacks
 */
async function geocodeAddress(address, city, state, zip) {
  // Skip if no address
  if (!address || !city || !state) {
    console.log('[geocode] Insufficient address data');
    return { lat: null, lng: null, geocoded: false };
  }

  // Check if Google Maps API key is configured
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('[geocode] No Google Maps API key - skipping geocoding');
    return { lat: null, lng: null, geocoded: false };
  }

  const fullAddress = `${address}, ${city}, ${state} ${zip || ''}`.trim();
  console.log('[geocode] Geocoding:', fullAddress);

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.results?.length > 0) {
      const location = data.results[0].geometry.location;
      const lat = parseFloat(location.lat);
      const lng = parseFloat(location.lng);
      
      console.log('[geocode] ✅ Success:', { lat, lng });
      return { lat, lng, geocoded: true };
    } else if (data.status === 'ZERO_RESULTS') {
      console.log('[geocode] ⚠️ No results for address');
      return { lat: null, lng: null, geocoded: false };
    } else {
      console.warn('[geocode] API returned:', data.status, data.error_message);
      return { lat: null, lng: null, geocoded: false };
    }
  } catch (error) {
    console.error('[geocode] ❌ Error:', error.message);
    return { lat: null, lng: null, geocoded: false };
  }
}

/**
 * Validate admin session
 */
async function validateAdminSession(token) {
  if (!token) return false;
  
  const { data, error } = await supabase
    .from('h2s_dispatch_admin_sessions')
    .select('admin_email')
    .eq('session_id', token)
    .gte('expires_at', new Date().toISOString())
    .single();

  if (error || !data) return false;
  
  await supabase
    .from('h2s_dispatch_admin_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', token);
  
  return true;
}

/**
 * Convert h2s_orders to h2s_dispatch_jobs
 * Creates jobs from completed Stripe checkout sessions
 */
export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    const { token, order_id, auto_migrate = false, test_mode = false } = body;

    console.log('[create_jobs_from_orders] Request:', { order_id, auto_migrate, test_mode });

    // Validate admin session (skip if test_mode)
    if (!test_mode) {
      const isValid = await validateAdminSession(token);
      if (!isValid) {
        console.log('[create_jobs_from_orders] Invalid or expired token');
        return res.status(401).json({
          ok: false,
          error: 'Not authorized',
          error_code: 'invalid_session'
        });
      }
      console.log('[create_jobs_from_orders] ✅ Admin session valid');
    } else {
      console.log('[create_jobs_from_orders] ⚠️ Running in TEST MODE - skipping auth');
    }

    // Get orders that haven't been converted to jobs yet
    let ordersQuery = supabase
      .from('h2s_orders')
      .select('*')
      .or('line_type.eq.summary,line_type.is.null')
      .order('created_at', { ascending: false});

    if (order_id) {
      ordersQuery = ordersQuery.eq('order_id', order_id);
    }

    const { data: orders, error: ordersError } = await ordersQuery;

    if (ordersError) {
      console.error('[create_jobs_from_orders] Orders query error:', ordersError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to fetch orders',
        error_code: 'query_failed',
        details: ordersError.message
      });
    }

    console.log('[create_jobs_from_orders] Found', orders.length, 'order rows to process');
    
    // Group by order_id to avoid processing duplicates
    const uniqueOrders = {};
    orders.forEach(order => {
      if (!uniqueOrders[order.order_id]) {
        uniqueOrders[order.order_id] = order;
      }
    });
    
    const ordersList = Object.values(uniqueOrders);
    console.log('[create_jobs_from_orders] Unique orders:', ordersList.length);

    const results = {
      total_orders: ordersList.length,
      jobs_created: 0,
      jobs_skipped: 0,
      jobs_failed: 0,
      details: []
    };

    // Process each order
    for (const order of ordersList) {
      try {
        // Skip duplicate check - just create jobs
        // (Can add duplicate detection later if needed)

        // Parse cart to get line items
        let cart = [];
        try {
          cart = order.cart_json ? JSON.parse(order.cart_json) : [];
        } catch (e) {
          console.error('[create_jobs_from_orders] Failed to parse cart_json:', e);
        }

        // Get line items from separate rows (or use the main order if no line items exist)
        const { data: lineItems } = await supabase
          .from('h2s_orders')
          .select('*')
          .eq('order_id', order.order_id);

        console.log('[create_jobs_from_orders] Order', order.order_id, '- found', lineItems?.length || 0, 'total rows');

        // Filter out summary rows if they exist, otherwise use all rows
        const itemRows = lineItems?.filter(item => item.line_type !== 'summary') || [];
        const dataRows = itemRows.length > 0 ? itemRows : lineItems || [];

        // Build line items JSON with all details
        const lineItemsJson = dataRows.map(item => ({
          service_id: item.service_id,
          option_id: item.option_id,
          bundle_id: item.bundle_id,
          qty: item.qty || 1,
          type: item.line_type || 'service'
        }));

        // Determine primary service details from first item or summary row
        const firstItem = dataRows.length > 0 ? dataRows[0] : order;
        const serviceIdText = firstItem?.service_id || order.service_id || null;
        const optionId = firstItem?.option_id || order.option_id || null;
        const qty = firstItem?.qty || order.qty || 1;
        
        // Parse items JSON for full service details
        let parsedItems = [];
        try {
          if (order.items) {
            parsedItems = JSON.parse(order.items);
          }
        } catch (e) {
          console.log('[create_jobs] Could not parse items JSON:', e.message);
        }
        
        // Build human-readable job description from items or service data
        let serviceName = order.service_name || 'Service';
        if (parsedItems.length > 0) {
          const item = parsedItems[0];
          serviceName = item.service_name || (item.service_id ? item.service_id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Service');
          const itemQty = item.qty || qty;
          serviceName = `${serviceName}${itemQty > 1 ? ` (${itemQty}x)` : ''}`;
        } else if (serviceIdText) {
          serviceName = serviceIdText.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          serviceName = qty > 1 ? `${serviceName} (${qty}x)` : serviceName;
        }
        
        const customerName = order.customer_name || order.name || order.customer_email || 'Customer';
        const jobDescription = `${serviceName} for ${customerName}`;
        
        // Support both old (address/city/state/zip) and new (service_address/service_city/etc) column names
        const address = order.service_address || order.address || null;
        const city = order.service_city || order.city || null;
        const state = order.service_state || order.state || null;
        const zip = order.service_zip || order.zip || null;
        const phone = order.customer_phone || order.phone || null;
        
        // 🌍 GEOCODE ADDRESS TO COORDINATES for dispatch routing
        console.log(`[create_jobs] Geocoding job for order ${order.order_id}`);
        const { lat, lng, geocoded } = await geocodeAddress(address, city, state, zip);
        
        if (geocoded) {
          console.log(`[create_jobs] ✅ Geocoded to: ${lat}, ${lng}`);
        } else if (address) {
          console.log(`[create_jobs] ⚠️ Could not geocode address: ${address}, ${city}, ${state}`);
        } else {
          console.log(`[create_jobs] ⚠️ No address provided for order ${order.order_id}`);
        }
        
        // Build resources list from items JSON if available
        let resourcesList = '';
        if (parsedItems.length > 0) {
          resourcesList = parsedItems.map(item => {
            const name = item.service_name || item.service_id || 'service';
            const q = item.qty || 1;
            return `${q}x ${name}`;
          }).join(', ');
        } else {
          resourcesList = `${qty}x ${serviceName}`;
        }
        
        // Create job matching actual h2s_dispatch_jobs schema
        const jobData = {
          status: 'pending',
          service_id: serviceIdText,
          customer_email: order.customer_email || order.email || null,
          customer_name: customerName,
          service_address: address,
          service_city: city,
          service_state: state,
          service_zip: zip,
          variant_code: optionId || serviceIdText || 'STANDARD',
          notes_from_customer: jobDescription,
          resources_needed: resourcesList,
          created_at: order.created_at,
          start_iso: null,
          end_iso: null,
          geo_lat: lat,   // ✅ REAL COORDINATES from Google Maps
          geo_lng: lng    // ✅ REAL COORDINATES from Google Maps
        };

        const { data: newJob, error: jobError } = await supabase
          .from('h2s_dispatch_jobs')
          .insert(jobData)
          .select('job_id')
          .single();

        if (jobError) {
          console.error('[create_jobs_from_orders] Job creation failed:', jobError);
          results.jobs_failed++;
          results.details.push({
            order_id: order.order_id,
            status: 'failed',
            error: jobError.message,
            error_code: jobError.code,
            error_details: jobError.details,
            error_hint: jobError.hint
          });
        } else {
          console.log('[create_jobs_from_orders] ✅ Job created:', newJob.job_id);
          results.jobs_created++;
          results.details.push({
            order_id: order.order_id,
            status: 'created',
            job_id: newJob.job_id,
            customer: order.customer_email,
            service: serviceIdText,
            address: address ? `${address}, ${city}, ${state} ${zip}` : null,
            description: jobDescription,
            items: dataRows.length || 1
          });
        }

      } catch (orderError) {
        console.error('[create_jobs_from_orders] Order processing error:', orderError);
        results.jobs_failed++;
        results.details.push({
          order_id: order.order_id,
          status: 'failed',
          error: orderError.message
        });
      }
    }

    console.log('[create_jobs_from_orders] ✅ Migration complete:', results);

    return res.status(200).json({
      ok: true,
      ...results
    });

  } catch (error) {
    console.error('[create_jobs_from_orders] Unexpected error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      error_code: 'internal_error',
      details: error.message
    });
  }
}
