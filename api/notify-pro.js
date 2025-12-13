// API endpoint: /api/notify-pro
// Sends job alerts to pros via SMS

// Validate email before sending notifications
function shouldSendEmailToPro(pro) {
  if (!pro || !pro.email) return false;
  const email = pro.email.trim().toLowerCase();
  if (email.length === 0 || email.includes(' ')) return false;
  const emailRegex = /^[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, job_id, pro_id, data, debug, force_sms_to, force_email_to } = req.body;

    if (!type || !job_id) {
      return res.status(400).json({ error: 'Missing required fields: type, job_id' });
    }

    // Debug mode: Get manager allowlists if provided
    let debugSmsRecipients = null;
    let debugEmailRecipients = null;
    if (debug === true && process.env.DEBUG_FIRE_KEY) {
      if (force_sms_to) {
        debugSmsRecipients = force_sms_to.split(',').map(p => p.trim()).filter(Boolean);
      }
      if (force_email_to) {
        debugEmailRecipients = force_email_to.split(',').map(e => e.trim()).filter(Boolean);
      }
    }

    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get job details with assignment info
    const { data: job, error: jobError } = await supabase
      .from('h2s_dispatch_jobs')
      .select(`
        *,
        h2s_dispatch_job_assignments!inner(
          pro_id,
          state,
          accepted_at
        )
      `)
      .eq('job_id', job_id)
      .single();

    if (jobError || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get pro details (from assignment or explicit pro_id)
    let pro = null;
    const targetProId = pro_id || job.h2s_dispatch_job_assignments?.pro_id;
    
    if (targetProId) {
      const { data: proData } = await supabase
        .from('h2s_dispatch_pros')
        .select('name, phone, email')
        .eq('pro_id', targetProId)
        .single();
      pro = proData;
    }

    // Build message based on notification type
    let message = '';
    let recipient = '';
    
    // Format date/time nicely
    const formatDate = (isoString) => {
      if (!isoString) return 'TBD';
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    };
    
    const formatTime = (isoString) => {
      if (!isoString) return 'TBD';
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    };

    const jobDate = formatDate(job.start_iso);
    const jobTime = formatTime(job.start_iso);
    const endTime = formatTime(job.end_iso);

    switch (type) {
      case 'new_job_assignment':
        if (!pro) {
          return res.status(400).json({ error: 'Pro ID required for job assignment' });
        }
        recipient = pro.phone;
        message = `Hi ${pro.name}! 📋 NEW JOB

Customer: ${job.customer_name}
Service: ${job.service_name || job.service_type || 'Service Request'}
When: ${jobDate}, ${jobTime} - ${endTime}
Where: ${job.service_address}, ${job.service_city}, ${job.service_state} ${job.service_zip}
Phone: ${job.customer_email || 'N/A'}

${job.notes_from_customer ? `Notes: ${job.notes_from_customer}\n\n` : ''}Tap to accept/view: https://home2smart.com/portal`;
        
        // Debug mode: Override recipient
        if (debugSmsRecipients && debugSmsRecipients.length > 0) {
          recipient = debugSmsRecipients;
          message = `[TEST:${type}] ${message}`;
        }
        break;

      case 'job_accepted_confirmation':
        if (!pro) {
          return res.status(400).json({ error: 'Pro ID required for confirmation' });
        }
        recipient = pro.phone;
        message = `Thanks ${pro.name}! ✅ Job confirmed

${job.customer_name} - ${jobDate} at ${jobTime}
${job.service_address}

You'll get a reminder the day before. View anytime: https://home2smart.com/portal`;
        break;

      case 'day_before_reminder':
        if (!pro) {
          return res.status(400).json({ error: 'Pro ID required for reminder' });
        }
        recipient = pro.phone;
        message = `Hey ${pro.name}! ⏰ TOMORROW

${jobTime} - ${job.customer_name}
${job.service_name || job.service_type || 'Service'}
${job.service_address}, ${job.service_city}

${job.notes_from_customer ? `Customer notes: ${job.notes_from_customer}\n\n` : ''}Ready? Reply YES to confirm or view: https://home2smart.com/portal`;
        break;

      case 'morning_of_reminder':
        if (!pro) {
          return res.status(400).json({ error: 'Pro ID required for reminder' });
        }
        recipient = pro.phone;
        message = `Good morning ${pro.name}! ☀️ TODAY

${jobTime} - ${job.customer_name}
${job.customer_email || 'No phone listed'}
${job.service_address}

${job.resources_needed || job.resources_needed_override ? `Bring: ${job.resources_needed || job.resources_needed_override}\n\n` : ''}Have a great job!`;
        break;

      case 'two_hour_reminder':
        if (!pro) {
          return res.status(400).json({ error: 'Pro ID required for reminder' });
        }
        recipient = pro.phone;
        message = `${pro.name} - 🚨 JOB IN 2 HOURS

${jobTime} - ${job.customer_name}
${job.service_address}
Call: ${job.customer_email || 'See portal'}

Tap when heading out to notify customer: https://home2smart.com/portal?notify=${job_id}`;
        break;

      case 'job_rescheduled':
        if (!pro) {
          return res.status(400).json({ error: 'Pro ID required for reschedule notification' });
        }
        recipient = pro.phone;
        const oldTime = data.old_time || 'TBD';
        const newTime = data.new_time || 'TBD';
        const rescheduleReason = data.reason || 'Customer request';
        message = `Hi ${pro.name}! 📅 JOB RESCHEDULED

${job.customer_name} - ${job.service_name || job.service_type}

Old time: ${data.old_date || 'TBD'} at ${oldTime}
New time: ${data.new_date || 'TBD'} at ${newTime}
Reason: ${rescheduleReason}

View updated details: https://home2smart.com/portal`;
        break;

      case 'payout_approved':
        if (!pro) {
          return res.status(400).json({ error: 'Pro ID required for payout notification' });
        }
        recipient = pro.phone;
        const amount = data.amount || '0.00';
        const jobRef = data.job_ref || `Job #${job_id?.substring(0, 8) || 'N/A'}`;
        message = `Hi ${pro.name}! ✅ PAYOUT APPROVED

Amount: $${amount}
Job: ${jobRef}

Payment is approved. You'll receive it per standard payout timing.

View details: https://home2smart.com/portal`;
        break;

      case 'customer_cancellation':
        // Send to all dispatch numbers
        recipient = (process.env.DISPATCH_PHONES || process.env.DISPATCH_PHONE || '8645281475').split(',').map(p => p.trim());
        message = `❌ CANCELLATION

${job.customer_name} canceled
Service: ${job.service_name || job.service_type}
Was scheduled: ${jobDate} at ${jobTime}
${pro ? `Assigned to: ${pro.name}` : 'Unassigned'}

Opening now available in schedule.`;
        break;
        // Send to all dispatch numbers
        recipient = (process.env.DISPATCH_PHONES || process.env.DISPATCH_PHONE || '8645281475').split(',').map(p => p.trim());
        message = `❌ CANCELLATION
${job.customer_name} canceled ${job.service_name || job.service_type}
Originally: ${new Date(job.appointment_date).toLocaleDateString()} at ${job.appointment_time}

Opening now available.`;
        break;

      case 'quote_request':
        // Send to all dispatch numbers
        recipient = (process.env.DISPATCH_PHONES || process.env.DISPATCH_PHONE || '8645281475').split(',').map(p => p.trim());
        message = `🔔 NEW QUOTE REQUEST

${data.customer_name}
${data.service_type}
📞 ${data.customer_phone}
📧 ${data.customer_email}

${data.message ? `Message: "${data.message}"\n\n` : ''}Follow up ASAP via portal: https://home2smart.com/portal`;
        break;

      case 'emergency_escalation':
        // Send to all dispatch numbers + assigned pro
        recipient = (process.env.DISPATCH_PHONES || process.env.DISPATCH_PHONE || '8645281475').split(',').map(p => p.trim());
        if (pro && !recipient.includes(pro.phone)) {
          recipient.push(pro.phone);
        }
        message = `🚨 URGENT COMPLAINT

Customer: ${job.customer_name}
Job: ${job_id}
${pro ? `Pro: ${pro.name}` : 'No pro assigned'}

Issue: "${data.complaint_text}"

CALL CUSTOMER NOW: ${job.customer_email || 'See portal'}
View job: https://home2smart.com/portal`;
        break;

      case 'job_completion_reminder':
        if (!pro) {
          return res.status(400).json({ error: 'Pro ID required' });
        }
        recipient = pro.phone;
        message = `${pro.name} - Don't forget! 📸

Mark job complete for ${job.customer_name}:
1. Upload photos
${job.completed_requires_signature === 'yes' ? '2. Get signature\n' : ''}3. Mark complete in portal

Complete now: https://home2smart.com/portal?complete=${job_id}`;
        break;

      default:
        return res.status(400).json({ error: `Unknown notification type: ${type}` });
    }

    // Debug mode: Override recipient and add test prefix
    if (debug === true && process.env.DEBUG_FIRE_KEY) {
      if (debugSmsRecipients && debugSmsRecipients.length > 0) {
        recipient = debugSmsRecipients;
      }
      message = `[TEST:${type}] ${message}`;
    }

    // Send SMS via send-sms endpoint
    // Handle single recipient or multiple (array)
    const recipients = Array.isArray(recipient) ? recipient : [recipient];
    const smsResults = [];
    const emailResults = [];

    for (const phone of recipients) {
      const smsPayload = {
        to: phone,
        message
      };
      
      // Add debug flags if in debug mode
      if (debug === true && process.env.DEBUG_FIRE_KEY) {
        smsPayload.debug = true;
        if (debugSmsRecipients && debugSmsRecipients.length > 0) {
          smsPayload.force_to = debugSmsRecipients.join(',');
        }
      }

      const smsResponse = await fetch(`${req.headers.host}/api/send-sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(smsPayload)
      });

      const smsResult = await smsResponse.json();
      smsResults.push({ phone, result: smsResult });
    }

    // Also send email if pro has email address (or debug mode with force_email_to)
    const shouldSendEmail = (pro && pro.email) || (debug === true && debugEmailRecipients && debugEmailRecipients.length > 0);
    // Validate email before sending
    const canSendEmail = shouldSendEmail && shouldSendEmailToPro(pro) && process.env.SENDGRID_ENABLED !== 'false';
    
    if (canSendEmail) {
      try {
        const emailData = {
          proName: pro.name,
          customerName: job.customer_name,
          service: job.service_name || job.service_type,
          date: jobDate,
          time: jobTime,
          address: job.service_address,
          city: job.service_city,
          state: job.service_state,
          customerPhone: job.customer_phone,
          notes: job.notes_from_customer || ''
        };

        const emailResponse = await fetch(`${req.headers.host}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: pro.email,
            template_key: `pro_${type}`,
            data: emailData,
            order_id: job.order_id
          })
        });

        const emailResult = await emailResponse.json();
        emailResults.push({ email: pro.email, result: emailResult });
        console.log(`[Notify Pro] Email sent to ${pro.email}`);
      } catch (err) {
        console.error('[Notify Pro] Email error:', err);
      }
    }

    return res.status(200).json({
      status: 'notification_sent',
      type,
      job_id,
      recipients,
      sms_results: smsResults,
      email_results: emailResults
    });

  } catch (error) {
    console.error('[Notify Pro] Failed:', error);
    return res.status(500).json({ 
      error: 'Failed to send notification',
      details: error.message 
    });
  }
}
