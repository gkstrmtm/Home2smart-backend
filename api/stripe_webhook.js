import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: false, // Must be false for Stripe webhooks
  },
};

/**
 * Geocode address using Google Maps API
 */
async function geocodeAddress(address, city, state, zip) {
  if (!address || !city || !state) {
    return { lat: null, lng: null, geocoded: false };
  }

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('[geocode] No API key');
    return { lat: null, lng: null, geocoded: false };
  }

  const fullAddress = `${address}, ${city}, ${state} ${zip || ''}`.trim();

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.results?.length > 0) {
      const location = data.results[0].geometry.location;
      return { 
        lat: parseFloat(location.lat), 
        lng: parseFloat(location.lng), 
        geocoded: true 
      };
    }
  } catch (error) {
    console.error('[geocode] Error:', error);
  }

  return { lat: null, lng: null, geocoded: false };
}

/**
 * Stripe webhook handler - auto-creates job after successful checkout
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  let rawBody = '';

  try {
    // Read raw body for signature verification
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    rawBody = Buffer.concat(chunks).toString('utf8');

    // Verify webhook signature
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  console.log('[webhook] Event type:', event.type);

  // Handle checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    console.log('[webhook] Checkout completed:', session.id);
    console.log('[webhook] Metadata:', session.metadata);

    const orderId = session.metadata?.order_id;

    if (!orderId) {
      console.warn('[webhook] No order_id in session metadata');
      return res.status(200).json({ received: true, warning: 'No order_id' });
    }

    try {
      // Get the order from database
      const { data: orders, error: orderError } = await supabase
        .from('h2s_orders')
        .select('*')
        .eq('order_id', orderId)
        .or('line_type.eq.summary,line_type.is.null');

      if (orderError) {
        console.error('[webhook] Order query failed:', orderError);
        return res.status(500).json({ error: 'Order query failed' });
      }

      if (!orders || orders.length === 0) {
        console.warn('[webhook] Order not found:', orderId);
        return res.status(404).json({ error: 'Order not found' });
      }

      const order = orders[0];
      console.log('[webhook] Found order:', order.order_id);

      // Check if job already exists
      const { data: existingJob } = await supabase
        .from('h2s_dispatch_jobs')
        .select('job_id')
        .eq('customer_email', order.customer_email)
        .eq('created_at', order.created_at)
        .limit(1);

      if (existingJob && existingJob.length > 0) {
        console.log('[webhook] Job already exists for this order');
        return res.status(200).json({ received: true, job_id: existingJob[0].job_id, status: 'already_exists' });
      }

      // Get line items for this order
      const { data: dataRows } = await supabase
        .from('h2s_orders')
        .select('*')
        .eq('order_id', orderId)
        .not('line_type', 'eq', 'summary')
        .order('line_index', { ascending: true });

      // Parse items JSON for service details
      let parsedItems = [];
      try {
        if (order.items) {
          parsedItems = JSON.parse(order.items);
        }
      } catch (e) {
        console.log('[webhook] Could not parse items JSON');
      }

      // Build job data
      const firstItem = dataRows && dataRows.length > 0 ? dataRows[0] : order;
      const serviceIdText = firstItem?.service_id || order.service_id || null;
      const optionId = firstItem?.option_id || order.option_id || null;
      const qty = firstItem?.qty || order.qty || 1;

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

      // Get address from Order OR Stripe Session
      let stripeAddress = session.shipping_details?.address || session.customer_details?.address;
      
      const address = order.service_address || order.address || stripeAddress?.line1 || null;
      const city = order.service_city || order.city || stripeAddress?.city || null;
      const state = order.service_state || order.state || stripeAddress?.state || null;
      const zip = order.service_zip || order.zip || stripeAddress?.postal_code || null;

      // Update Order if address was missing but found in Stripe Session
      if ((!order.address && !order.service_address) && address) {
          console.log('[webhook] Updating order with address from Stripe Session');
          await supabase.from('h2s_orders').update({
              address: address,
              city: city,
              state: state,
              zip: zip,
              service_address: address,
              service_city: city,
              service_state: state,
              service_zip: zip
          }).eq('order_id', orderId);
      }

      // Geocode address
      console.log('[webhook] Geocoding address:', address, city);
      const { lat, lng, geocoded } = await geocodeAddress(address, city, state, zip);
      
      if (geocoded) {
        console.log('[webhook] ✅ Geocoded to:', lat, lng);
      } else {
        console.log('[webhook] ⚠️ Geocoding failed or no address');
      }

      // Calculate Estimated Payout (Optimized for Fairness & Conversion)
      let estimatedPayout = 0;
      const orderTotal = parseFloat(order.total || session.amount_total / 100 || 0);
      
      // HEURISTIC: 60% of Customer Total (Fairness Baseline)
      let basePayout = Math.floor(orderTotal * 0.60);
      
      // Adjust for specific known high-labor items
      const serviceLower = (serviceIdText || '').toLowerCase();
      if (basePayout < 45 && serviceLower.includes('mount')) {
         basePayout = 45 * qty; // Minimum standard for mounting
      }
      
      // Apply Floor and Cap
      const MIN_PAYOUT = 35; // Minimum to roll a truck
      const MAX_PAYOUT_PCT = 0.80; // Max 80% to ensure business margin
      
      estimatedPayout = Math.max(MIN_PAYOUT, basePayout);
      if (orderTotal > 0) {
          estimatedPayout = Math.min(estimatedPayout, orderTotal * MAX_PAYOUT_PCT);
      }
      
      // Round to 2 decimals
      estimatedPayout = Math.round(estimatedPayout * 100) / 100;
      console.log(`[webhook] Payout Calculated: $${estimatedPayout} (Order: $${orderTotal})`);

      // Build resources list
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

      // Create job
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
        geo_lat: lat,
        geo_lng: lng,
        metadata: {
            source: 'stripe_webhook',
            estimated_payout: estimatedPayout,
            order_id: orderId,
            stripe_session_id: session.id
        }
      };

      const { data: newJob, error: jobError } = await supabase
        .from('h2s_dispatch_jobs')
        .insert(jobData)
        .select('job_id')
        .single();

      if (jobError) {
        console.error('[webhook] Job creation failed:', jobError);
        return res.status(500).json({ error: 'Job creation failed', details: jobError.message });
      }

      console.log('[webhook] ✅ Job created:', newJob.job_id);

      // ========================================
      // UPDATE CUSTOMER PROFILE (for marketing)
      // ========================================
      try {
        const customerEmail = (order.customer_email || order.email || '').toLowerCase();
        
        if (customerEmail) {
          console.log('[webhook] Syncing customer profile:', customerEmail);
          
          // Call customer profile sync endpoint
          const syncUrl = `${req.headers.host?.startsWith('localhost') ? 'http' : 'https'}://${req.headers.host}/api/customer_profile_sync`;
          
          const syncResponse = await fetch(syncUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              email: customerEmail,
              order_id: orderId 
            })
          });

          if (syncResponse.ok) {
            const syncResult = await syncResponse.json();
            console.log('[webhook] ✅ Customer profile synced:', syncResult.customer?.customer_tier || 'unknown tier');
          } else {
            console.warn('[webhook] ⚠️ Profile sync failed (non-blocking):', syncResponse.status);
          }
        }
      } catch (profileError) {
        // Don't fail the webhook if profile sync fails
        console.error('[webhook] Profile sync error (non-blocking):', profileError.message);
      }

      return res.status(200).json({
        received: true,
        job_id: newJob.job_id,
        order_id: orderId,
        geocoded: geocoded
      });

    } catch (error) {
      console.error('[webhook] Error creating job:', error);
      return res.status(500).json({ error: 'Job creation error', details: error.message });
    }
  }

  // Return 200 for other event types
  return res.status(200).json({ received: true });
}
