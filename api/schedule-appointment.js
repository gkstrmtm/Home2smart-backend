import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

/**
 * Schedule appointment for an existing paid order
 * Called from bundles-success.html after customer picks date/time from custom calendar
 */
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
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) {}
    }

    const { 
      order_id,           // From Stripe session (passed via URL params)
      delivery_date,      // YYYY-MM-DD
      delivery_time,      // "2:00 PM" or "2:00 PM - 5:00 PM"
      start_iso,          // ISO 8601 timestamp (optional, for dispatch jobs)
      end_iso,            // ISO 8601 timestamp (optional)
      timezone,           // Customer's timezone (optional)
      lat,                // Optional: Manual latitude (for testing/bypass)
      lng                 // Optional: Manual longitude (for testing/bypass)
    } = body;

    // Validation
    if (!order_id) {
      return res.status(400).json({ ok: false, error: 'Missing order_id' });
    }
    if (!delivery_date || !delivery_time) {
      return res.status(400).json({ ok: false, error: 'Missing delivery_date or delivery_time' });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(delivery_date)) {
      console.error('[Schedule] Invalid date format:', delivery_date);
      return res.status(400).json({ ok: false, error: 'Invalid date format. Expected YYYY-MM-DD' });
    }

    // Validate date is not in the past
    const selectedDate = new Date(delivery_date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (selectedDate < today) {
      console.error('[Schedule] Date is in the past:', delivery_date);
      return res.status(400).json({ ok: false, error: 'Cannot schedule appointments in the past' });
    }

    // Validate date is within 90 days
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 90);
    
    if (selectedDate > maxDate) {
      console.error('[Schedule] Date too far in future:', delivery_date);
      return res.status(400).json({ ok: false, error: 'Cannot schedule more than 90 days in advance' });
    }

    // Check capacity for this date/time slot to prevent overbooking
    const MAX_JOBS_PER_SLOT = 3; // Default capacity
    const { data: existingBookings, error: capacityError } = await supabase
      .from('h2s_orders')
      .select('id')
      .eq('delivery_date', delivery_date)
      .eq('delivery_time', delivery_time);

    if (capacityError) {
      console.error('[Schedule] Capacity check failed:', capacityError);
      // Don't block booking if capacity check fails, just log
    } else if (existingBookings && existingBookings.length >= MAX_JOBS_PER_SLOT) {
      console.warn(`[Schedule] ⚠️ Time slot overbooked: ${delivery_date} ${delivery_time} (${existingBookings.length}/${MAX_JOBS_PER_SLOT})`);
      return res.status(409).json({ 
        ok: false, 
        error: `This time slot is fully booked. We have ${existingBookings.length} jobs already scheduled. Please choose a different date or time window.`,
        error_code: 'slot_full',
        spots_remaining: 0
      });
    }

    console.log('[Schedule] Incoming payload', {
      order_id,
      delivery_date,
      delivery_time,
      start_iso,
      end_iso,
      timezone
    });

    // 1. Get existing order by order_id (UUID) OR session_id (Stripe session)
    let query = supabase.from('h2s_orders').select('*');
    
    // Try to find by UUID first, then by order_id string, else by session_id
    if (order_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      console.log('[Schedule] Lookup mode: UUID id', order_id);
      query = query.eq('id', order_id);
    } else if (order_id.startsWith('order_')) {
      console.log('[Schedule] Lookup mode: order_id', order_id);
      query = query.eq('order_id', order_id);
    } else {
      console.log('[Schedule] Lookup mode: session_id', order_id);
      query = query.eq('session_id', order_id);
    }
    
    const { data: order, error: orderError } = await query.single();

    if (orderError || !order) {
      console.error('[Schedule] Order not found');
      console.error('[Schedule] Supabase error:', orderError?.message || 'none');
      console.error('[Schedule] Lookup key:', order_id);
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    console.log('[Schedule] ✅ Found order:', order.order_id);

    // 2. Update order with appointment details
    const updatePayload = {
      delivery_date: delivery_date,
      delivery_time: delivery_time,
      updated_at: new Date().toISOString()
    };
    
    const { error: updateError } = await supabase
      .from('h2s_orders')
      .update(updatePayload)
      .eq('id', order.id);

    if (updateError) {
      console.error('[Schedule] Update failed:', updateError);
      console.error('[Schedule] Update payload:', updatePayload);
      console.error('[Schedule] Target row id:', order.id);
      return res.status(500).json({ ok: false, error: updateError.message });
    }

    console.log(`[Schedule] ✅ Order ${order.order_id} updated with appointment`);

    // 3. Send "appointment_scheduled" notifications (SMS + Email)
    const customerName = order.customer_name || order.name || '';
    const firstName = customerName.split(' ')[0] || 'Customer';
    const serviceName = order.service_name || 'service';
    
    const notificationData = {
      firstName: firstName,
      service: serviceName,
      date: formatDate(delivery_date),
      time: delivery_time,
      city: order.city || order.service_city || 'your area',
      state: order.state || order.service_state || ''
    };

    // Send SMS
    if (order.customer_phone && process.env.TWILIO_ENABLED !== 'false') {
      try {
        // Check for duplicate SMS
        const { data: existingSms } = await supabase
          .from('h2s_sms_log')
          .select('id')
          .eq('job_id', order_id)
          .eq('template_name', 'appointment_scheduled')
          .single();

        if (existingSms) {
          console.log('[Schedule] SMS already sent for this appointment, skipping.');
        } else {
          const smsResponse = await fetch(`${getBaseUrl(req)}/api/send-sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: order.customer_phone,
              template_key: 'appointment_scheduled',
              data: notificationData,
              job_id: order_id // Use order_id as job_id for tracking
            })
          });
          const smsResult = await smsResponse.json();
          if (smsResult.ok) {
            console.log(`[Schedule] ✅ SMS sent to ${order.customer_phone}`);
          } else {
            console.warn(`[Schedule] ⚠️ SMS failed:`, smsResult.error);
          }
        }
      } catch (err) {
        console.error('[Schedule] SMS error:', err);
      }
    }

    // Send Email
    if (order.customer_email && process.env.SENDGRID_ENABLED !== 'false') {
      try {
        const emailResponse = await fetch(`${getBaseUrl(req)}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: order.customer_email,
            template_key: 'appointment_scheduled',
            data: notificationData,
            order_id: order_id
          })
        });
        const emailResult = await emailResponse.json();
        if (emailResult.ok) {
          console.log(`[Schedule] ✅ Email sent to ${order.customer_email}`);
        } else {
          console.warn(`[Schedule] ⚠️ Email failed:`, emailResult.error);
        }
      } catch (err) {
        console.error('[Schedule] Email error:', err);
      }
    }

    // Helper: Geocode address
    async function geocodeAddress(address, city, state, zip) {
      if (!address || !city || !state) return { lat: null, lng: null };
      if (!process.env.GOOGLE_MAPS_API_KEY) {
        console.warn('[Schedule] Missing GOOGLE_MAPS_API_KEY, skipping geocoding');
        return { lat: null, lng: null };
      }

      const fullAddress = `${address}, ${city}, ${state} ${zip || ''}`.trim();
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'OK' && data.results?.length > 0) {
          const loc = data.results[0].geometry.location;
          return { lat: loc.lat, lng: loc.lng };
        }
      } catch (e) {
        console.error('[Schedule] Geocoding error:', e);
      }
      return { lat: null, lng: null };
    }

    // 4. Create or Update dispatch job + Auto-assign to best available pro
    if (start_iso && end_iso) {
      try {
        // Extract metadata safely
        let orderMeta = {};
        try {
            if (order.metadata && typeof order.metadata === 'object') {
                orderMeta = order.metadata;
            } else if (order.metadata_json) {
                orderMeta = typeof order.metadata_json === 'string' ? JSON.parse(order.metadata_json) : order.metadata_json;
            }
        } catch (e) { console.warn('[Schedule] Metadata parse error:', e); }

        // Map order columns to address variables (handle legacy/different schemas)
        // CHECK METADATA FIRST as it's often where Stripe/Shop data lives
        const address = orderMeta.service_address || orderMeta.address || order.address || order.service_address || order.shipping_address || '';
        const city = orderMeta.service_city || orderMeta.city || order.city || order.service_city || order.shipping_city || '';
        const state = orderMeta.service_state || orderMeta.state || order.state || order.service_state || order.shipping_state || '';
        const zip = orderMeta.service_zip || orderMeta.zip || order.zip || order.service_zip || order.shipping_zip || '';

        console.log(`[Schedule] Resolved address: "${address}", "${city}", "${state}" "${zip}"`);
        console.log('[Schedule] Order Meta keys:', Object.keys(orderMeta));
        console.log('[Schedule] Order keys:', Object.keys(order));

        // Geocode the address first (or use provided coordinates)
        let geoLat = lat;
        let geoLng = lng;

        if (!geoLat || !geoLng) {
            const { lat: gLat, lng: gLng } = await geocodeAddress(address, city, state, zip);
            geoLat = gLat;
            geoLng = gLng;
            console.log(`[Schedule] Geocoded address to: ${geoLat}, ${geoLng}`);
        } else {
            console.log(`[Schedule] Using provided coordinates: ${geoLat}, ${geoLng}`);
        }

        // Check for existing job first to avoid duplicates
        const { data: existingJob } = await supabase
          .from('h2s_dispatch_jobs')
          .select('job_id')
          .eq('order_id', order_id)
          .single();

        let jobId;

        if (existingJob) {
          console.log(`[Schedule] ✅ Found existing job ${existingJob.job_id}, updating schedule...`);
          
          const updateData = {
            start_iso: start_iso,
            end_iso: end_iso,
            status: 'scheduled',
            // Append scheduling note
            notes_from_customer: order.notes_from_customer 
              ? `${order.notes_from_customer}\n(Scheduled via portal)` 
              : `Scheduled via portal`
          };

          // Update coordinates if we have them
          if (geoLat && geoLng) {
            updateData.geo_lat = geoLat;
            updateData.geo_lng = geoLng;
          }
          
          // Update address fields if they were missing
          if (address) updateData.service_address = address;
          if (city) updateData.service_city = city;
          if (state) updateData.service_state = state;
          if (zip) updateData.service_zip = zip;

          const { error: updateJobError } = await supabase
            .from('h2s_dispatch_jobs')
            .update(updateData)
            .eq('job_id', existingJob.job_id);

          if (updateJobError) {
            console.error('[Schedule] Job update failed:', updateJobError);
            // Don't throw, just log - we still want to try assignment if possible
          }
          
          jobId = existingJob.job_id;

        } else {
          // Job doesn't exist yet (webhook might be delayed), create it now
          console.log('[Schedule] Job not found, creating new one...');
          
          const jobData = {
            status: 'scheduled',
            order_id: order_id,
            service_id: order.service_name,
            customer_email: order.customer_email,
            customer_name: order.customer_name,
            customer_phone: order.customer_phone,
            service_address: address,
            service_city: city,
            service_state: state,
            service_zip: zip,
            notes_from_customer: `Scheduled via portal`,
            start_iso: start_iso,
            end_iso: end_iso,
            created_at: new Date().toISOString(),
            // Try to include metadata if available (handle metadata_json from h2s_orders)
            metadata: orderMeta || order.metadata || {},
            geo_lat: geoLat,
            geo_lng: geoLng
          };

          const { data: newJob, error: jobError } = await supabase
            .from('h2s_dispatch_jobs')
            .insert(jobData)
            .select('job_id')
            .single();

          if (jobError) {
            console.warn('[Schedule] Job creation failed:', jobError);
          } else {
            console.log(`[Schedule] ✅ Dispatch job created: ${newJob.job_id}`);
            jobId = newJob.job_id;

            // --- PAYOUT & JOB LINE CREATION (Copied from create_jobs_from_orders.js) ---
            try {
                // Calculate Payout
                const orderSubtotal = parseFloat(order.subtotal || order.total || 0);
                const orderTotal = parseFloat(order.total || 0);
                
                // 35% of Subtotal Rule
                let estimatedPayout = Math.floor(orderSubtotal * 0.35);
                
                // Adjust for mounting minimums
                const serviceLower = (order.service_name || '').toLowerCase();
                if (estimatedPayout < 45 && serviceLower.includes('mount')) {
                   estimatedPayout = 45; 
                }
                
                // Floor and Cap
                const MIN_PAYOUT = 35;
                const MAX_PAYOUT_PCT = 0.45;
                
                estimatedPayout = Math.max(MIN_PAYOUT, estimatedPayout);
                if (orderSubtotal > 0) {
                    estimatedPayout = Math.min(estimatedPayout, orderSubtotal * MAX_PAYOUT_PCT);
                }
                estimatedPayout = Math.round(estimatedPayout * 100) / 100;

                console.log(`[Schedule] Calculated Payout: $${estimatedPayout} (Order: $${orderTotal})`);

                // Create Job Line
                const { error: lineError } = await supabase
                  .from('h2s_dispatch_job_lines')
                  .insert({
                    job_id: jobId,
                    service_id: null, 
                    variant_code: 'STANDARD',
                    qty: 1,
                    unit_customer_price: orderTotal,
                    line_customer_total: orderTotal,
                    calc_pro_payout_total: estimatedPayout,
                    note: `Auto-generated from schedule-appointment`,
                    order_id: order_id,
                    created_at: new Date().toISOString()
                  });
                
                if (lineError) console.warn('[Schedule] Failed to create job line:', lineError.message);
                else console.log('[Schedule] ✅ Job line created with payout');

                // Update job metadata with payout
                const newMeta = { ...(order.metadata || {}), estimated_payout: estimatedPayout };
                await supabase.from('h2s_dispatch_jobs').update({ metadata: newMeta }).eq('job_id', jobId);

            } catch (payoutErr) {
                console.error('[Schedule] Payout calculation error:', payoutErr);
            }
            // --------------------------------------------------------------------------
          }
        }

        if (jobId) {
          // Auto-assign to best available pro using intelligent routing
          try {
            const { data: assignedPro, error: assignError } = await supabase.rpc('auto_assign_job_to_pro', {
              p_job_id: jobId,
              p_service_id: order.service_id || order.service_name,
              p_date: delivery_date,
              p_time_slot: delivery_time,
              p_customer_lat: order.customer_lat || 34.8526, // Default to Greenville if not provided
              p_customer_lng: order.customer_lng || -82.3940
            });

            if (assignedPro) {
              console.log(`[Schedule] ✅ Pro auto-assigned: ${assignedPro}`);
              
              // Update job with assigned pro
              await supabase
                .from('h2s_dispatch_jobs')
                .update({ 
                  assigned_to: assignedPro,
                  status: 'assigned'
                })
                .eq('job_id', jobId);

              // Send "pro_assigned" notification to pro
              try {
                const { data: proInfo } = await supabase
                  .from('h2s_dispatch_pros')
                  .select('name, email, phone')
                  .eq('pro_id', assignedPro)
                  .single();

                if (proInfo && proInfo.phone) {
                  await fetch(`${getBaseUrl(req)}/api/send-sms`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      to: proInfo.phone,
                      template_key: 'pro_job_assigned',
                      data: {
                        service: order.service_name || 'service',
                        date: formatDate(delivery_date),
                        time: delivery_time,
                        customerName: order.customer_name || 'Customer',
                        address: order.service_address || '',
                        city: order.service_city || '',
                        customerPhone: order.customer_phone || 'Not provided'
                      },
                      order_id: order_id
                    })
                  });
                  console.log(`[Schedule] ✅ Pro SMS sent to ${proInfo.name}`);
                  
                  // Also send email to pro if they have one
                  if (proInfo.email && process.env.SENDGRID_ENABLED !== 'false') {
                    try {
                      await fetch(`${getBaseUrl(req)}/api/send-email`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          to: proInfo.email,
                          template_key: 'pro_job_assigned',
                          data: {
                            proName: proInfo.name.split(' ')[0],
                            service: order.service_name || 'service',
                            date: formatDate(delivery_date),
                            time: delivery_time,
                            customerName: order.customer_name || 'Customer',
                            address: order.service_address || '',
                            city: order.service_city || '',
                            state: order.service_state || 'SC',
                            customerPhone: order.customer_phone || 'Not provided',
                            notes: order.notes_from_customer || ''
                          },
                          order_id: order_id
                        })
                      });
                      console.log(`[Schedule] ✅ Pro email sent to ${proInfo.name}`);
                    } catch (emailErr) {
                      console.warn('[Schedule] Pro email failed (non-critical):', emailErr);
                    }
                  }
                }
              } catch (err) {
                console.warn('[Schedule] Pro notification failed (non-critical):', err);
              }
            } else if (assignError) {
              console.warn('[Schedule] Pro assignment failed:', assignError.message);
              
              // Notify management of assignment failure
              try {
                await fetch(`${getBaseUrl(req)}/api/notify-management`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    type: 'proAssignmentFailed',
                    data: {
                      jobId: jobId.slice(0, 8).toUpperCase(),
                      service: order.service_name || 'service',
                      date: formatDate(delivery_date),
                      time: delivery_time,
                      customerName: order.customer_name || 'Customer',
                      city: order.service_city || 'Unknown',
                      state: order.service_state || 'SC'
                    }
                  })
                });
                console.log('[Schedule] Management notified of assignment failure');
              } catch (err) {
                console.error('[Schedule] Management notification failed:', err);
              }
            }
          } catch (err) {
            console.warn('[Schedule] Auto-assignment error (non-critical):', err);
          }
        }
      } catch (err) {
        console.warn('[Schedule] Dispatch job creation failed (non-critical):', err);
      }
    }

    return res.json({ 
      ok: true, 
      message: 'Appointment scheduled successfully',
      order_id: order_id,
      delivery_date: delivery_date,
      delivery_time: delivery_time
    });

  } catch (error) {
    console.error('[Schedule] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}

// Helper: Get base URL for internal API calls
function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Helper: Format date for display
function formatDate(dateStr) {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });
  } catch (e) {
    return dateStr;
  }
}
