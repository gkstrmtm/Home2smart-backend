import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY // Fallback for local testing
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

    const { token, order_id, auto_migrate = false, test_mode = false, auto_trigger = false } = body;

    console.log('[create_jobs_from_orders] Request:', { order_id, auto_migrate, test_mode, auto_trigger });

    // Validate admin session (skip if test_mode or auto_trigger from webhook)
    if (!test_mode && !auto_trigger) {
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
    } else if (auto_trigger) {
      console.log('[create_jobs_from_orders] ✅ Auto-triggered from webhook - skipping auth');
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
        
        // Extract metadata (contains service_address, service_city, service_state, service_zip from checkout)
        let orderMetadata = {};
        try {
          if (order.metadata && typeof order.metadata === 'object') {
            orderMetadata = order.metadata;
          } else if (order.metadata_json && typeof order.metadata_json === 'string') {
            orderMetadata = JSON.parse(order.metadata_json);
          } else if (order.metadata_json && typeof order.metadata_json === 'object') {
            orderMetadata = order.metadata_json;
          }
        } catch (e) {
          console.warn('[create_jobs] Could not parse order metadata:', e.message);
        }
        
        // Support both metadata fields and legacy top-level columns
        const address = orderMetadata.service_address || order.service_address || order.address || null;
        const city = orderMetadata.service_city || order.service_city || order.city || null;
        const state = orderMetadata.service_state || order.service_state || order.state || null;
        const zip = orderMetadata.service_zip || order.service_zip || order.zip || null;
        const phone = orderMetadata.customer_phone || order.customer_phone || order.phone || null;
        
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

        // 👤 ENSURE CUSTOMER PROFILE EXISTS
        // We upsert into h2s_users to ensure we have a profile for this customer
        if (order.customer_email) {
          try {
            // Check if user exists first to get ID, or generate new one
            const { data: existingUser } = await supabase
              .from('h2s_users')
              .select('user_id')
              .eq('email', order.customer_email)
              .single();

            const userId = existingUser?.user_id || crypto.randomUUID();

            const { error: userError } = await supabase
              .from('h2s_users')
              .upsert({
                user_id: userId, // Ensure ID is provided
                email: order.customer_email,
                full_name: customerName,
                phone: phone,
                // Don't overwrite existing data if not necessary, but ensure record exists
                updated_at: new Date().toISOString()
              }, { onConflict: 'email' });
              
            if (userError) {
              console.warn('[create_jobs] Failed to upsert user profile:', userError.message);
            } else {
              console.log('[create_jobs] ✅ Customer profile verified/created for:', order.customer_email);
            }
          } catch (e) {
            console.warn('[create_jobs] User profile sync error:', e.message);
          }
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

        // Calculate Estimated Payout (Optimized for Fairness & Conversion)
        // Logic: 
        // 1. Try to find exact DB rule (future proofing)
        // 2. Fallback to Percentage of Order Value (Fairness)
        // 3. Enforce Floor ($35) and Cap (80%)
        let estimatedPayout = 0;
        
        // Use subtotal (pre-discount) for payout calculation so promos don't reduce pro earnings
        // Fallback to total if subtotal doesn't exist (backward compatibility)
        const orderSubtotal = parseFloat(order.subtotal || order.total || 0);
        const orderTotal = parseFloat(order.total || 0);
        
        console.log(`[create_jobs] Order financials - Subtotal: $${orderSubtotal}, Total: $${orderTotal}`);
        
        // Try to find service ID and Qty from parsed items if top-level is missing or generic
        let effectiveServiceId = serviceIdText;
        let effectiveQty = qty;

        if ((!effectiveServiceId || parsedItems.length > 0) && parsedItems.length > 0) {
          effectiveServiceId = parsedItems[0].service_id || parsedItems[0].service_name || effectiveServiceId;
          effectiveQty = parsedItems[0].qty || effectiveQty;
        }
        
        // PAYOUT LOGIC: 35% of Customer Subtotal (industry standard for service marketplaces)
        // This ensures healthy business margins (65%) to cover overhead, marketing, insurance, platform costs
        // Uses pre-discount subtotal so promos don't reduce pro earnings
        let basePayout = Math.floor(orderSubtotal * 0.35);
        
        // Adjust for specific known high-labor items if order total is low/missing
        const serviceLower = (effectiveServiceId || '').toLowerCase();
        if (basePayout < 45 && serviceLower.includes('mount')) {
           basePayout = 45 * effectiveQty; // Minimum standard for mounting
        }
        
        // Apply Floor and Cap
        const MIN_PAYOUT = 35; // Minimum to roll a truck
        const MAX_PAYOUT_PCT = 0.45; // Cap at 45% to maintain business margin
        
        estimatedPayout = Math.max(MIN_PAYOUT, basePayout);
        // Cap at 45% of subtotal to ensure minimum 55% business margin
        if (orderSubtotal > 0) {
            estimatedPayout = Math.min(estimatedPayout, orderSubtotal * MAX_PAYOUT_PCT);
        }
        
        // Round to 2 decimals
        estimatedPayout = Math.round(estimatedPayout * 100) / 100;
        
        console.log(`[create_jobs] Payout Calculated: $${estimatedPayout} (Order: $${orderTotal})`);

        // Extract metadata from order
        const orderMeta = order.metadata_json || {};
        const jobMetadata = {
          source: 'shop_order',
          order_id: order.order_id,
          referral_code: orderMeta.referral_code || null,
          referrer_email: orderMeta.referrer_email || null,
          estimated_payout: estimatedPayout,
          items_json: parsedItems
        };
        
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
          geo_lat: lat ? lat.toString() : null,   // Convert to TEXT for database
          geo_lng: lng ? lng.toString() : null,    // Convert to TEXT for database
          metadata: {
            ...jobMetadata,
            service_address: address,  // Add to metadata for portal queries
            geo_lat: lat,              // Keep numeric in metadata
            geo_lng: lng               // Keep numeric in metadata
          }
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
          
          // 🔥 AUTO-ASSIGN TO AVAILABLE PROS (so they see it in portal immediately)
          // Query pros within service radius who are active
          try {
            if (lat && lng) {
              const { data: nearbyPros, error: prosError } = await supabase.rpc('find_pros_in_radius', {
                p_lat: lat,
                p_lng: lng,
                p_radius_miles: 50, // Default search radius
                p_limit: 10 // Assign to top 10 nearest pros
              });
              
              if (!prosError && nearbyPros && nearbyPros.length > 0) {
                console.log(`[create_jobs_from_orders] Found ${nearbyPros.length} nearby pros, creating assignments...`);
                
                const assignments = nearbyPros.map(pro => ({
                  job_id: newJob.job_id,
                  pro_id: pro.pro_id,
                  state: 'offered', // Show as pending offer in portal
                  distance_miles: pro.distance_miles,
                  offer_sent_at: new Date().toISOString(),
                  created_at: new Date().toISOString()
                }));
                
                const { error: assignError } = await supabase
                  .from('h2s_dispatch_job_assignments')
                  .insert(assignments);
                
                if (assignError) {
                  console.warn('[create_jobs_from_orders] ⚠️ Failed to create assignments:', assignError.message);
                } else {
                  console.log(`[create_jobs_from_orders] ✅ Created ${assignments.length} job assignments`);
                }
              } else {
                console.warn('[create_jobs_from_orders] ⚠️ No nearby pros found or RPC error:', prosError?.message);
              }
            }
          } catch (assignErr) {
            console.warn('[create_jobs_from_orders] Assignment creation error:', assignErr.message);
          }
          
          // 🔥 CREATE JOB LINE ITEM WITH PAYOUT DATA
          // This is the missing piece - persist payout amount as queryable line item
          try {
            const { error: lineError } = await supabase
              .from('h2s_dispatch_job_lines')
              .insert({
                job_id: newJob.job_id,
                service_id: null, // Schema expects UUID, serviceIdText is often a string - set NULL
                variant_code: optionId || serviceIdText || 'STANDARD',
                qty: effectiveQty,
                unit_customer_price: orderTotal > 0 ? Math.round((orderTotal / effectiveQty) * 100) / 100 : 0,
                line_customer_total: orderTotal,
                calc_pro_payout_total: estimatedPayout, // 💰 THE MONEY FIELD
                note: `Auto-generated from order ${order.order_id}`,
                order_id: order.order_id,
                created_at: order.created_at
              });
            
            if (lineError) {
              console.warn('[create_jobs_from_orders] ⚠️ Failed to create job line:', lineError.message);
            } else {
              console.log('[create_jobs_from_orders] ✅ Job line created with payout: $' + estimatedPayout);
            }
          } catch (lineErr) {
            console.warn('[create_jobs_from_orders] Job line creation error:', lineErr.message);
          }
          
          results.jobs_created++;
          results.details.push({
            order_id: order.order_id,
            status: 'created',
            job_id: newJob.job_id,
            customer: order.customer_email,
            service: serviceIdText,
            address: address ? `${address}, ${city}, ${state} ${zip}` : null,
            description: jobDescription,
            items: dataRows.length || 1,
            payout: estimatedPayout // Include in response
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
