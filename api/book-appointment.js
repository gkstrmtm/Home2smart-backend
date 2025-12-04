import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role to bypass RLS
);

/**
 * Geocode address using Google Maps API
 */
async function geocodeAddress(address, city, state, zip) {
  if (!address || !city || !state) return { lat: null, lng: null };
  if (!process.env.GOOGLE_MAPS_API_KEY) return { lat: null, lng: null };

  const fullAddress = `${address}, ${city}, ${state} ${zip || ''}`.trim();
  
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.results?.length > 0) {
      const location = data.results[0].geometry.location;
      return { lat: parseFloat(location.lat), lng: parseFloat(location.lng) };
    }
  } catch (error) {
    console.error('[geocode] Error:', error.message);
  }
  return { lat: null, lng: null };
}

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Handle both raw body and parsed body
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) {}
    }

    const { order_id, install_at, install_end_at, email, timezone } = body;

    if (!order_id || !install_at) {
      return res.status(400).json({ ok: false, error: 'Missing order_id or install_at' });
    }

    console.log(`[Book] Booking appointment for Order ${order_id} at ${install_at}`);

    // 1. Get Order Details
    const { data: order, error: orderError } = await supabase
      .from('h2s_orders')
      .select('*')
      .eq('order_id', order_id)
      .maybeSingle(); // Use maybeSingle to avoid error if not found (handle manually)

    if (orderError) throw orderError;
    
    // If order not found in DB, we can't create a job from it easily without more data.
    // But bundles.html sends email, so maybe we can look up by email if order_id is missing?
    // bundles.html sends order_id.
    
    if (!order) {
      console.warn(`[Book] Order ${order_id} not found in h2s_orders. Creating job with minimal info.`);
      // Fallback: Create job with just the info we have
    }

    // 2. Prepare Job Data
    const customerName = order?.customer_name || order?.name || email || 'Customer';
    const serviceName = order?.service_id || 'Service';
    const address = order?.service_address || order?.address;
    const city = order?.service_city || order?.city;
    const state = order?.service_state || order?.state;
    const zip = order?.service_zip || order?.zip;

    // 3. Geocode
    const { lat, lng } = await geocodeAddress(address, city, state, zip);

    // 4. Build Resources List (What needs to be installed?)
    let resourcesList = '';
    try {
      let items = [];
      if (order?.items) {
        items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
      } else if (order?.cart_json) {
        items = typeof order.cart_json === 'string' ? JSON.parse(order.cart_json) : order.cart_json;
      }
      
      if (items && items.length > 0) {
        resourcesList = items.map(item => {
          const name = item.service_name || item.name || item.service_id || 'Service';
          const q = item.qty || item.quantity || 1;
          return `${q}x ${name}`;
        }).join(', ');
      }
    } catch (e) {
      console.warn('[Book] Failed to parse items for resources_needed', e);
    }
    
    if (!resourcesList) {
      resourcesList = `1x ${serviceName}`;
    }

    // 5. Create Job
    const jobData = {
      status: 'scheduled',
      service_id: serviceName,
      customer_email: email,
      customer_name: customerName,
      service_address: address,
      service_city: city,
      service_state: state,
      service_zip: zip,
      variant_code: order?.option_id || 'STANDARD',
      notes_from_customer: `Booked via Portal. Order: ${order_id}`,
      resources_needed: resourcesList, // ✅ Added to match schema
      created_at: new Date().toISOString(),
      start_iso: install_at,
      end_iso: install_end_at,
      geo_lat: lat,
      geo_lng: lng
    };

    const { data: newJob, error: jobError } = await supabase
      .from('h2s_dispatch_jobs')
      .insert(jobData)
      .select('job_id')
      .single();

    if (jobError) {
      console.error('[Book] Job creation failed:', jobError);
      return res.status(500).json({ ok: false, error: jobError.message });
    }

    console.log(`[Book] ✅ Job created: ${newJob.job_id}`);

    // 5. Update Order with appointment time (if order exists)
    if (order) {
      await supabase
        .from('h2s_orders')
        .update({ install_at: install_at })
        .eq('order_id', order_id);
    }

    // ============================================================
    // NOTIFICATIONS (Twilio / SendGrid)
    // ============================================================
    
    const installDate = new Date(install_at);
    const dateStr = installDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const timeStr = installDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const firstName = customerName.split(' ')[0];
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://h2s-backend.vercel.app';

    // 1. Send SMS to Customer
    if (process.env.TWILIO_ENABLED === 'true') {
      try {
        const smsMessage = `Hi ${firstName}, your ${serviceName} appointment is confirmed for ${dateStr} at ${timeStr}. See you then! - Home2Smart`;
        
        // Use internal API to handle logging and fallback
        await fetch(`${baseUrl}/api/send-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: order?.customer_phone || order?.phone, // Use phone from order if available
            message: smsMessage,
            template: 'booking_confirmation',
            job_id: newJob.job_id
          })
        });
        console.log('[Book] SMS notification sent');
      } catch (smsError) {
        console.error('[Book] Failed to send SMS:', smsError.message);
      }
    }

    // 2. Send Email to Customer
    if (process.env.SENDGRID_ENABLED !== 'false' && email) {
      try {
        await fetch(`${baseUrl}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to_email: email,
            template_key: 'booking_confirmation',
            order_id: order_id,
            data: {
              firstName: firstName,
              service: serviceName,
              date: dateStr,
              time: timeStr
            }
          })
        });
        console.log('[Book] Email notification sent');
      } catch (emailError) {
        console.error('[Book] Failed to send Email:', emailError.message);
      }
    }

    return res.json({ ok: true, job_id: newJob.job_id });

  } catch (error) {
    console.error('[Book] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
