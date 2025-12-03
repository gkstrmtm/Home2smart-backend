import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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
      timezone            // Customer's timezone (optional)
    } = body;

    // Validation
    if (!order_id) {
      return res.status(400).json({ ok: false, error: 'Missing order_id' });
    }
    if (!delivery_date || !delivery_time) {
      return res.status(400).json({ ok: false, error: 'Missing delivery_date or delivery_time' });
    }

    console.log(`[Schedule] Scheduling appointment for Order ${order_id}: ${delivery_date} at ${delivery_time}`);

    // 1. Get existing order by order_id (UUID) OR stripe_session_id
    let query = supabase.from('h2s_orders').select('*');
    
    // Try to find by UUID first, then by session_id
    if (order_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      query = query.eq('order_id', order_id);
    } else {
      query = query.eq('stripe_session_id', order_id);
    }
    
    const { data: order, error: orderError } = await query.single();

    if (orderError || !order) {
      console.error('[Schedule] Order not found:', orderError);
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // 2. Update order with appointment details
    const updatePayload = {
      delivery_date: delivery_date,
      service_date: delivery_date  // Also set service_date for compatibility
    };
    
    const updateQuery = order_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      ? supabase.from('h2s_orders').update(updatePayload).eq('order_id', order_id)
      : supabase.from('h2s_orders').update(updatePayload).eq('stripe_session_id', order_id);
    
    const { error: updateError } = await updateQuery;

    if (updateError) {
      console.error('[Schedule] Update failed:', updateError);
      return res.status(500).json({ ok: false, error: updateError.message });
    }

    console.log(`[Schedule] ✅ Order ${order_id} updated with appointment`);

    // 3. Send "appointment_scheduled" notifications (SMS + Email)
    const customerName = order.customer_name || order.name || '';
    const firstName = customerName.split(' ')[0] || 'Customer';
    const notificationData = {
      firstName: firstName,
      service: order.order_summary || 'service',
      date: formatDate(delivery_date),
      time: delivery_time
    };

    // Send SMS
    if (order.customer_phone && process.env.TWILIO_ENABLED !== 'false') {
      try {
        const smsResponse = await fetch(`${getBaseUrl(req)}/api/send-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: order.customer_phone,
            template_key: 'appointment_scheduled',
            data: notificationData,
            order_id: order_id
          })
        });
        const smsResult = await smsResponse.json();
        if (smsResult.ok) {
          console.log(`[Schedule] ✅ SMS sent to ${order.customer_phone}`);
        } else {
          console.warn(`[Schedule] ⚠️ SMS failed:`, smsResult.error);
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

    // 4. Create dispatch job + Auto-assign to best available pro
    if (start_iso && end_iso) {
      try {
        // First, create the job
        const jobData = {
          status: 'scheduled',
          order_id: order_id,
          service_id: order.service_name,
          customer_email: order.customer_email,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          service_address: order.service_address || '',
          service_city: order.service_city || '',
          service_state: order.service_state || '',
          service_zip: order.service_zip || '',
          notes_from_customer: `Scheduled via portal`,
          start_iso: start_iso,
          end_iso: end_iso,
          created_at: new Date().toISOString()
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

          // Auto-assign to best available pro using intelligent routing
          try {
            const { data: assignedPro, error: assignError } = await supabase.rpc('auto_assign_job_to_pro', {
              p_job_id: newJob.job_id,
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
                .eq('job_id', newJob.job_id);

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
                      template_key: 'pro_assigned',
                      data: {
                        proName: proInfo.name.split(' ')[0],
                        service: order.service_name || 'service',
                        date: formatDate(delivery_date),
                        time: delivery_time,
                        customerName: order.customer_name || 'Customer',
                        address: `${order.service_city || ''}, ${order.service_state || 'SC'}`
                      },
                      order_id: order_id
                    })
                  });
                  console.log(`[Schedule] ✅ Pro notification sent to ${proInfo.name}`);
                }
              } catch (err) {
                console.warn('[Schedule] Pro notification failed (non-critical):', err);
              }
            } else if (assignError) {
              console.warn('[Schedule] Pro assignment failed:', assignError.message);
              // Job still created, just not assigned yet (manual assignment needed)
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
