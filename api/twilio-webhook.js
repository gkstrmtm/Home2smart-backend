import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

export default async function handler(req, res) {
  // Only accept POST from Twilio
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate Twilio signature for security
    const twilioSignature = req.headers['x-twilio-signature'];
    const url = `https://${req.headers.host}${req.url}`;
    
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      console.error('[Twilio Webhook] Missing TWILIO_AUTH_TOKEN');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Verify request is from Twilio
    const isValid = twilio.validateRequest(
      authToken,
      twilioSignature,
      url,
      req.body
    );

    if (!isValid && process.env.NODE_ENV === 'production') {
      console.warn('[Twilio Webhook] Invalid signature');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // Parse incoming SMS data
    const {
      From: fromPhone,
      To: toPhone,
      Body: messageBody,
      MessageSid: messageSid,
      AccountSid: accountSid
    } = req.body;

    console.log('[Twilio Webhook] Incoming SMS:', {
      from: fromPhone,
      to: toPhone,
      body: messageBody,
      sid: messageSid
    });

    // Initialize Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Log message to database
    await supabase.from('sms_messages').insert({
      message_sid: messageSid,
      from_phone: fromPhone,
      to_phone: toPhone,
      body: messageBody,
      direction: 'inbound',
      status: 'received',
      created_at: new Date().toISOString()
    });

    // Look up customer and their most recent upcoming order
    const { data: customer } = await supabase
      .from('h2s_users')
      .select('email, full_name, phone, id')
      .eq('phone', fromPhone)
      .single();

    // Find most recent upcoming order for this phone number
    const { data: upcomingOrder } = await supabase
      .from('h2s_orders')
      .select('*')
      .eq('customer_phone', fromPhone)
      .in('status', ['paid', 'scheduled'])
      .gte('delivery_date', new Date().toISOString().split('T')[0])
      .order('delivery_date', { ascending: true })
      .limit(1)
      .single();

    // Auto-respond based on keywords
    const bodyUpper = (messageBody || '').toUpperCase().trim();
    let templateKey = null;
    let templateData = {};
    let orderUpdate = {};

    if (bodyUpper.includes('CONFIRM') || bodyUpper === 'YES') {
      templateKey = 'inbound_confirm_reply';
      if (upcomingOrder) {
        templateData = {
          date: upcomingOrder.delivery_date || 'soon',
          time: upcomingOrder.delivery_time || 'TBD'
        };
        orderUpdate = { appointment_confirmed: true };
      }
    } else if (bodyUpper.includes('CANCEL')) {
      templateKey = 'inbound_cancel_reply';
      if (upcomingOrder) {
        orderUpdate = { cancellation_requested: true };
      }
    } else if (bodyUpper.includes('RESCHEDULE')) {
      templateKey = 'inbound_reschedule_reply';
      if (upcomingOrder) {
        orderUpdate = { needs_reschedule: true };
      }
    } else if (bodyUpper === 'STOP' || bodyUpper === 'UNSUBSCRIBE' || bodyUpper === 'CANCEL') {
      templateKey = 'inbound_stop_reply';
      // Mark customer as unsubscribed
      if (customer) {
        await supabase
          .from('h2s_users')
          .update({ 
            sms_unsubscribed: true,
            sms_opt_out_date: new Date().toISOString()
          })
          .eq('phone', fromPhone);
      }
    } else if (bodyUpper === 'START' || bodyUpper === 'SUBSCRIBE') {
      templateKey = 'inbound_start_reply';
      if (customer) {
        await supabase
          .from('h2s_users')
          .update({ 
            sms_unsubscribed: false,
            sms_opt_in_date: new Date().toISOString()
          })
          .eq('phone', fromPhone);
      }
    } else {
      // Default response for unrecognized messages
      templateKey = 'inbound_default_reply';
    }

    // Update order if we have one and need to update it
    if (upcomingOrder && Object.keys(orderUpdate).length > 0) {
      await supabase
        .from('h2s_orders')
        .update(orderUpdate)
        .eq('id', upcomingOrder.id);
      
      console.log('[Twilio Webhook] Updated order:', upcomingOrder.id, orderUpdate);
    }

    // Get template from database
    const { data: template } = await supabase
      .from('h2s_sms_templates')
      .select('body')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .single();

    let responseMessage = template?.body || 'Thanks for your message. Our team will respond shortly.';
    
    // Render template with data
    Object.keys(templateData).forEach(key => {
      const placeholder = `{${key}}`;
      responseMessage = responseMessage.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), templateData[key] || '');
    });

    // Send TwiML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage}</Message>
</Response>`;

    // Log outbound response
    await supabase.from('sms_messages').insert({
      from_phone: toPhone,
      to_phone: fromPhone,
      body: responseMessage,
      direction: 'outbound',
      status: 'sent',
      message_type: templateKey,
      created_at: new Date().toISOString()
    });

    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml);

  } catch (error) {
    console.error('[Twilio Webhook] Error:', error);
    
    // Return empty TwiML to prevent Twilio retry storms
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>We're experiencing technical difficulties. Please call (864) 528-1475 for immediate assistance.</Message>
</Response>`;
    
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(errorTwiml);
  }
}
