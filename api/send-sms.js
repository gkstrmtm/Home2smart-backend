import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

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
    const { to, message, template = 'default', job_id = null } = req.body;

    if (!to || !message) {
      return res.status(400).json({ ok: false, error: 'Missing required fields: to, message' });
    }

    // Initialize Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Check if user has opted out
    const { data: user } = await supabase
      .from('h2s_users')
      .select('sms_opt_out')
      .eq('phone', to)
      .single();

    if (user?.sms_opt_out) {
      console.log('[Send SMS] User opted out:', to);
      
      // Log as skipped
      await supabase.from('h2s_sms_log').insert({
        phone: to,
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

    // Check rate limiting (max 3 SMS per day)
    const { data: recentMessages, error: rateLimitError } = await supabase
      .from('h2s_sms_log')
      .select('id')
      .eq('phone', to)
      .gte('sent_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
      .eq('status', 'sent');

    if (!rateLimitError && recentMessages && recentMessages.length >= 3) {
      console.log('[Send SMS] Rate limit exceeded:', to);
      
      await supabase.from('h2s_sms_log').insert({
        phone: to,
        message,
        status: 'skipped',
        template_name: template,
        job_id,
        error_message: 'Rate limit: 3 SMS per day exceeded'
      });

      return res.status(429).json({ 
        ok: false, 
        error: 'Rate limit exceeded (max 3 SMS per day)' 
      });
    }

    // Check time window (7am - 9pm)
    const hour = new Date().getHours();
    if (hour < 7 || hour >= 21) {
      console.log('[Send SMS] Outside send window:', hour);
      
      await supabase.from('h2s_sms_log').insert({
        phone: to,
        message,
        status: 'skipped',
        template_name: template,
        job_id,
        error_message: `Outside send window: ${hour}:00 (allowed 7am-9pm)`
      });

      return res.status(400).json({ 
        ok: false, 
        error: 'Outside send window (7am-9pm only)' 
      });
    }

    // Initialize Twilio client
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = process.env.TWILIO_PHONE_NUMBER;
    const useTwilio = process.env.USE_TWILIO === 'true';

    // Send via Twilio if enabled and configured
    if (useTwilio && accountSid && authToken && fromPhone) {
      try {
        const client = twilio(accountSid, authToken);
        const smsResult = await client.messages.create({
          body: message,
          from: fromPhone,
          to: to
        });

        console.log('[Send SMS] Twilio sent:', {
          to,
          template,
          sid: smsResult.sid,
          status: smsResult.status
        });

        // Log success
        await supabase.from('h2s_sms_log').insert({
          phone: to,
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
        console.error('[Send SMS] Twilio failed:', twilioError);
        
        // Log failure
        await supabase.from('h2s_sms_log').insert({
          phone: to,
          message,
          status: 'failed',
          template_name: template,
          job_id,
          error_message: twilioError.message
        });

        // Fall through to SendGrid fallback
      }
    }

    // Fallback: SendGrid email-to-SMS
    const sendgridKey = process.env.SENDGRID_API_KEY;
    if (!sendgridKey) {
      return res.status(500).json({ ok: false, error: 'No SMS provider configured' });
    }

    const emailBody = `SMS to ${to}:\n\n${message}`;
    const sendGridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: `${to.replace(/\D/g, '')}@tmomail.net` }]
        }],
        from: { email: 'noreply@home2smart.com', name: 'Home2Smart' },
        subject: 'Message from Home2Smart',
        content: [{ type: 'text/plain', value: emailBody }]
      })
    });

    if (sendGridResponse.ok) {
      console.log('[Send SMS] SendGrid fallback sent:', to);
      
      await supabase.from('h2s_sms_log').insert({
        phone: to,
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
        phone: to,
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
