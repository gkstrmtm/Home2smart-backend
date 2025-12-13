import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';
import { SMS_TEMPLATES } from './config/notifications.js';

const SMS_COMPLIANCE = {
  maxPerDay: 3,
  allowedHours: { start: 7, end: 21 }
};

export default async function handler(req, res) {
  // CORS headers
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { to, template, template_key, data, job_id = null, debug, force_to } = req.body;
    let { message } = req.body;

    // Debug mode: Override recipient if force_to provided and debug=true
    let actualRecipient = to;
    if (debug === true && force_to && process.env.DEBUG_FIRE_KEY) {
      // Use first recipient from force_to (comma-separated)
      actualRecipient = force_to.split(',')[0].trim();
      console.log('[Send SMS] DEBUG MODE: Overriding recipient', { original: to, override: actualRecipient });
    }

    // Resolve message from template if not provided
    const key = template_key || template;
    if (!message && key && SMS_TEMPLATES[key] && data) {
      let text = SMS_TEMPLATES[key].message;
      Object.keys(data).forEach(k => {
        text = text.replace(new RegExp(`{${k}}`, 'g'), data[k] || '');
      });
      message = text;
    }

    if (!actualRecipient || !message) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: to, message (or valid template)' });
    }

    // Add test prefix if debug mode
    if (debug === true && process.env.DEBUG_FIRE_KEY) {
      const templateName = template_key || template || 'unknown';
      message = `[TEST:${templateName}] ${message}`;
    }

    // Initialize Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Idempotency: Check if same message sent recently (same job_id + template within 5 minutes)
    // Skip idempotency check in debug mode
    if (!debug && job_id && template) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('h2s_sms_log')
        .select('id')
        .eq('phone', actualRecipient)
        .eq('job_id', job_id)
        .eq('template_name', template)
        .eq('status', 'sent')
        .gte('sent_at', fiveMinutesAgo)
        .limit(1);
      
      if (recent && recent.length > 0) {
        console.log('[Send SMS] Duplicate detected, skipping');
        return res.status(200).json({
          ok: true,
          skipped: true,
          reason: 'Duplicate message prevented (sent within last 5 minutes)'
        });
      }
    }

    // Check if user has opted out (skip in debug mode)
    let user = null;
    if (!debug) {
      const { data: userData } = await supabase
        .from('h2s_users')
        .select('sms_opt_out')
        .eq('phone', actualRecipient)
        .single();
      user = userData;
    }

    if (user?.sms_opt_out) {
      console.log('[Send SMS] User opted out:', to);
      
      // Log as skipped
      await supabase.from('h2s_sms_log').insert({
        phone: actualRecipient,
        message,
        status: 'skipped',
        template_name: template,
        job_id,
        error_message: 'User opted out'
      });

      return res.status(200).json({ 
        ok: true, 
        skipped: true, 
        reason: 'User opted out from SMS' 
      });
    }

    // Check rate limiting (TEMPORARILY DISABLED FOR TESTING)
    // const { data: recentMessages, error: rateLimitError } = await supabase
    //   .from('h2s_sms_log')
    //   .select('id')
    //   .eq('phone', to)
    //   .gte('sent_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
    //   .eq('status', 'sent');

    // if (!rateLimitError && recentMessages && recentMessages.length >= SMS_COMPLIANCE.maxPerDay) {
    //   console.log('[Send SMS] Rate limit exceeded:', to);
      
    //   await supabase.from('h2s_sms_log').insert({
    //     phone: to,
    //     message,
    //     status: 'skipped',
    //     template_name: template,
    //     job_id,
    //     error_message: 'Rate limit: 3 SMS per day exceeded'
    //   });

    //   return res.status(429).json({ 
    //     ok: false, 
    //     error: `Rate limit exceeded (max ${SMS_COMPLIANCE.maxPerDay} SMS per day)` 
    //   });
    // }

    // Check time window (EST) - Skip for testing
    // TODO: Re-enable after testing
    // const estHour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
    // if (parseInt(estHour) < SMS_COMPLIANCE.allowedHours.start || parseInt(estHour) >= SMS_COMPLIANCE.allowedHours.end) {
    //   console.log('[Send SMS] Outside send window:', estHour);
    //   return res.status(400).json({ 
    //     ok: false, 
    //     error: 'Outside send window (7am-9pm EST only)' 
    //   });
    // }

    // Initialize Twilio client
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;
    const useTwilio = process.env.USE_TWILIO?.toLowerCase() === 'true';

    // Send via Twilio if enabled and configured
    console.log('[Send SMS] Twilio check:', {
      useTwilio,
      hasAccountSid: !!accountSid,
      hasAuthToken: !!authToken,
      hasFromPhone: !!fromPhone,
      fromPhone
    });

    if (useTwilio && accountSid && authToken && fromPhone) {
      try {
        console.log('[Send SMS] Attempting Twilio send...');
        const client = twilio(accountSid, authToken);
        const smsResult = await client.messages.create({
          body: message,
          from: fromPhone,
          to: actualRecipient
        });

        console.log('[Send SMS] Twilio SUCCESS:', {
          to: actualRecipient,
          template,
          sid: smsResult.sid,
          status: smsResult.status,
          errorCode: smsResult.errorCode,
          errorMessage: smsResult.errorMessage
        });

        // Log success
        await supabase.from('h2s_sms_log').insert({
          phone: actualRecipient,
          message,
          status: 'sent',
          template_name: template,
          job_id
        });

        return res.status(200).json({
          ok: true,
          method: 'twilio',
          message_sid: smsResult.sid,
          status: smsResult.status
        });
      } catch (twilioError) {
        console.error('[Send SMS] Twilio ERROR:', {
          message: twilioError.message,
          code: twilioError.code,
          status: twilioError.status,
          moreInfo: twilioError.moreInfo,
          details: twilioError.details
        });
        
        // Log failure with full details
        await supabase.from('h2s_sms_log').insert({
          phone: actualRecipient,
          message,
          status: 'failed',
          template_name: template,
          job_id,
          error_message: `${twilioError.code}: ${twilioError.message}`
        });

        // DO NOT RETURN HERE - FALL THROUGH TO SENDGRID
        console.log('[Send SMS] Falling back to SendGrid...');
      }
    }

    // Fallback: SendGrid email-to-SMS
    const sendgridKey = process.env.SENDGRID_API_KEY;
    if (!sendgridKey) {
      return res.status(500).json({ ok: false, error: 'No SMS provider configured' });
    }

    const emailBody = `SMS to ${actualRecipient}:\n\n${message}`;
    const sendGridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: `${actualRecipient.replace(/\D/g, '')}@tmomail.net` }]
        }],
        from: { email: 'noreply@home2smart.com', name: 'Home2Smart' },
        subject: 'Message from Home2Smart',
        content: [{ type: 'text/plain', value: emailBody }]
      })
    });

    if (sendGridResponse.ok) {
      console.log('[Send SMS] SendGrid fallback sent:', actualRecipient);
      
      await supabase.from('h2s_sms_log').insert({
        phone: actualRecipient,
        message,
        status: 'sent',
        template_name: template,
        job_id
      });

      return res.status(200).json({
        ok: true,
        method: 'sendgrid_fallback',
        note: 'Sent via email-to-SMS (limited reliability)'
      });
    } else {
      const errorText = await sendGridResponse.text();
      console.error('[Send SMS] All methods failed:', errorText);
      
      await supabase.from('h2s_sms_log').insert({
        phone: actualRecipient,
        message,
        status: 'failed',
        template_name: template,
        job_id,
        error_message: `SendGrid failed: ${errorText}`
      });

      return res.status(500).json({
        ok: false,
        error: 'All SMS methods failed'
      });
    }

  } catch (error) {
    console.error('[Send SMS] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Failed to send SMS'
    });
  }
}
