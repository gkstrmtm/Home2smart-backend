// API endpoint: /api/notify-customer
// Sends customer journey SMS (booking confirmation, reminders, review requests, etc.)

import { SMS_TEMPLATES } from '../lib/sms-templates.js';

function fillTemplate(template, variables) {
  let filled = template;
  Object.keys(variables).forEach(key => {
    const placeholder = `{${key}}`;
    filled = filled.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), variables[key] || '');
  });
  return filled;
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
    const { type, job_id, customer_phone, variables } = req.body;

    if (!type || !customer_phone) {
      return res.status(400).json({ error: 'Missing required fields: type, customer_phone' });
    }

    // Initialize Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get job details if job_id provided
    let job = null;
    if (job_id) {
      const { data: jobData } = await supabase
        .from('h2s_dispatch_jobs')
        .select('*')
        .eq('job_id', job_id)
        .single();
      job = jobData;
    }

    // Build template variables
    const templateVars = {
      customer_name: job?.customer_name || variables?.customer_name || 'Customer',
      service_name: job?.service_name || variables?.service_name || 'Service',
      date: job?.appointment_date ? new Date(job.appointment_date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : variables?.date,
      time: job?.appointment_time || variables?.time,
      time_window: job?.time_window || variables?.time_window,
      address: job?.address || variables?.address,
      pro_name: job?.pro_name || variables?.pro_name || 'Your Pro',
      pro_rating: job?.pro_rating || variables?.pro_rating || '4.9',
      total_amount: job?.total_amount || variables?.total_amount,
      job_id: job_id || '',
      ...variables
    };

    // Select message template
    let message = '';
    let templateName = '';

    switch (type) {
      case 'booking_confirmation':
        templateName = 'booking_confirmation';
        message = fillTemplate(
          `✅ Booked! {service_name} on {date}\n\nTime: {time_window}\nWhere: {address}\n\nWe're assigning your pro now. You'll get confirmation once scheduled.\n\nNeed to change? https://home2smart.com/reschedule?job={job_id}\n\n- Home2Smart`,
          templateVars
        );
        break;

      case 'pro_assigned':
        templateName = 'pro_assigned';
        message = fillTemplate(
          `👍 Your pro is confirmed!\n\n{pro_name} ⭐{pro_rating} will handle your {service_name}\n\n{date} at {time_window}\n{address}\n\nYou'll get reminders before they arrive.\n\n- Home2Smart`,
          templateVars
        );
        break;

      case '24hr_reminder':
        templateName = '24hr_reminder';
        message = fillTemplate(
          `⏰ Tomorrow {time_window}\n\n{pro_name} → {service_name}\n{address}\n\nReply YES to confirm or reschedule: https://home2smart.com/reschedule?job={job_id}\n\nQuestions? Text: 864-528-1475`,
          templateVars
        );
        break;

      case 'morning_reminder':
        templateName = 'morning_reminder';
        message = fillTemplate(
          `☀️ TODAY: {time_window}\n\n{pro_name} will text 15 min before arrival for {service_name}\n\nAddress confirmed: {address}\n\nRunning late? Text: 864-528-1475`,
          templateVars
        );
        break;

      case 'on_the_way':
        templateName = 'on_the_way';
        message = fillTemplate(
          `🚗 {pro_name} is 15 min away\n\n{service_name}\nArriving: ~{estimated_arrival}\n\nSee you soon!`,
          templateVars
        );
        break;

      case 'check_in':
        templateName = 'check_in';
        message = fillTemplate(
          `✅ {pro_name} has arrived and started your {service_name}\n\nWe'll text you when complete.`,
          templateVars
        );
        break;

      case 'job_complete':
        templateName = 'job_complete';
        message = fillTemplate(
          `✅ Done! {service_name} complete\n\nHow'd {pro_name} do? Leave a review (30 sec):\nhttps://home2smart.com/reviews\n\nThanks for trusting us!\n- Home2Smart`,
          templateVars
        );
        break;

      case 'review_request':
        templateName = 'review_request';
        message = fillTemplate(
          `⭐ Quick favor?\n\nShare your {service_name} experience (takes 30 sec)\n\nhttps://home2smart.com/reviews\n\nYour feedback helps families find great pros. Thank you! 🙏`,
          templateVars
        );
        break;

      case 'review_reminder':
        templateName = 'review_reminder';
        message = fillTemplate(
          `Quick favor? ⭐\n\nMind sharing how {pro_name} did on your {service_name}?\n\nhttps://home2smart.com/reviews\n\nThanks!\n- Home2Smart`,
          templateVars
        );
        break;

      case '7day_checkin':
        templateName = '7day_checkin';
        message = fillTemplate(
          `👋 {customer_name}, checking in!\n\nHow's your {service_name} holding up?\n\nAny issues? Just text back.\nNeed something else? https://home2smart.com/book\n\n- Home2Smart Team`,
          templateVars
        );
        break;

      case 'missed_appointment':
        templateName = 'missed_appointment';
        message = fillTemplate(
          `We missed you today! 😔\n\nNo worries - reschedule anytime:\nhttps://home2smart.com/reschedule?job={job_id}\n\nOr call: 864-528-1475\n\n- Home2Smart`,
          templateVars
        );
        break;

      case 'cancellation_confirmation':
        templateName = 'cancellation_confirmation';
        message = fillTemplate(
          `✅ Appointment Canceled\n\n{service_name} on {date}\n\nChanged your mind? Reschedule:\nhttps://home2smart.com/reschedule\n\n- Home2Smart`,
          templateVars
        );
        break;

      default:
        return res.status(400).json({ error: `Unknown notification type: ${type}` });
    }

    // Send SMS
    const baseUrl = `https://${req.headers.host}`;
    const smsResponse = await fetch(`${baseUrl}/api/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: customer_phone,
        message,
        template: templateName,
        job_id
      })
    });

    const smsResult = await smsResponse.json();

    return res.status(200).json({
      status: 'notification_sent',
      type,
      job_id,
      customer_phone,
      template: templateName,
      sms_result: smsResult
    });

  } catch (error) {
    console.error('[Notify Customer] Failed:', error);
    return res.status(500).json({ 
      error: 'Failed to send notification',
      details: error.message 
    });
  }
}
