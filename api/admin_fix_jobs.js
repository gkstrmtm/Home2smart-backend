
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const { token } = req.query;
  
  // Simple security check (or remove if you want it public for a minute)
  // if (token !== process.env.ADMIN_TOKEN) return res.status(401).send('Unauthorized');

  try {
    // 1. Get jobs with missing location
    const { data: jobs, error } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .or('geo_lat.is.null,geo_lng.is.null')
      .order('created_at', { ascending: false })
      .limit(50); // Process in batches

    if (error) throw error;

    const results = [];

    for (const job of jobs) {
      let log = { job_id: job.job_id, status: 'pending' };
      
      try {
        // 2. Find the order
        // We try to find the order by email and approximate time, or metadata if available
        let order = null;
        
        if (job.metadata?.order_id) {
             const { data: o } = await supabase.from('h2s_orders').select('*').eq('order_id', job.metadata.order_id).single();
             order = o;
        }
        
        if (!order) {
            // Fallback: find most recent order for this customer before job creation
            const { data: orders } = await supabase
                .from('h2s_orders')
                .select('*')
                .eq('customer_email', job.customer_email)
                .order('created_at', { ascending: false })
                .limit(1);
            if (orders && orders.length) order = orders[0];
        }

        if (!order) {
            log.status = 'skipped_no_order';
            results.push(log);
            continue;
        }

        // 3. Get Address from Stripe if missing in Order
        let address = job.service_address || order.address || order.service_address;
        let city = job.service_city || order.city || order.service_city;
        let state = job.service_state || order.state || order.service_state;
        let zip = job.service_zip || order.zip || order.service_zip;
        let stripeSessionId = order.stripe_session_id || order.session_id || job.metadata?.stripe_session_id;

        if ((!address || !city) && stripeSessionId) {
            try {
                const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
                const details = session.shipping_details?.address || session.customer_details?.address;
                if (details) {
                    address = details.line1;
                    city = details.city;
                    state = details.state;
                    zip = details.postal_code;
                    log.source = 'stripe';
                    
                    // Update order while we are at it
                    await supabase.from('h2s_orders').update({
                        address, city, state, zip,
                        service_address: address,
                        service_city: city,
                        service_state: state,
                        service_zip: zip
                    }).eq('order_id', order.order_id);
                }
            } catch (e) {
                console.error('Stripe error:', e.message);
            }
        }

        if (!address || !city) {
            log.status = 'skipped_no_address';
            results.push(log);
            continue;
        }

        // 4. Geocode
        const fullAddress = `${address}, ${city}, ${state} ${zip || ''}`;
        const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        const geoRes = await fetch(geoUrl);
        const geoData = await geoRes.json();

        let lat = null, lng = null;
        if (geoData.status === 'OK' && geoData.results?.[0]) {
            lat = geoData.results[0].geometry.location.lat;
            lng = geoData.results[0].geometry.location.lng;
        }

        // 5. Calculate Payout if missing
        let payout = job.metadata?.estimated_payout;
        if (!payout) {
            const total = parseFloat(order.total || 0);
            let base = Math.floor(total * 0.60);
            if (base < 45 && (job.service_id||'').toLowerCase().includes('mount')) base = 45;
            payout = Math.max(35, base);
            if (total > 0) payout = Math.min(payout, total * 0.80);
            payout = Math.round(payout * 100) / 100;
        }

        // 6. Update Job
        const updateData = {
            service_address: address,
            service_city: city,
            service_state: state,
            service_zip: zip,
            geo_lat: lat,
            geo_lng: lng,
            metadata: {
                ...job.metadata,
                estimated_payout: payout,
                fixed_by: 'admin_fix_jobs'
            }
        };

        const { error: updateError } = await supabase
            .from('h2s_dispatch_jobs')
            .update(updateData)
            .eq('job_id', job.job_id);

        if (updateError) throw updateError;

        log.status = 'fixed';
        log.address = fullAddress;
        log.payout = payout;
        log.geo = { lat, lng };
        results.push(log);

      } catch (err) {
        log.status = 'error';
        log.error = err.message;
        results.push(log);
      }
    }

    res.json({
        ok: true,
        processed: results.length,
        results
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
