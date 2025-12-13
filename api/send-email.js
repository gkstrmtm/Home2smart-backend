import sgMail from '@sendgrid/mail';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Helper function to render template with data
function renderTemplate(template, data) {
  let rendered = template;
  Object.keys(data).forEach(key => {
    const regex = new RegExp(`{${key}}`, 'g');
    rendered = rendered.replace(regex, data[key] || '');
  });
  return rendered;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { template_key, data, to_email, order_id, user_id, debug, force_email_to } = req.body;

  // Debug mode: Override recipient if force_email_to provided and debug=true
  let actualRecipient = to_email;
  if (debug === true && force_email_to && process.env.DEBUG_FIRE_KEY) {
    // Use first recipient from force_email_to (comma-separated)
    actualRecipient = force_email_to.split(',')[0].trim();
    console.log('[Send Email] DEBUG MODE: Overriding recipient', { original: to_email, override: actualRecipient });
  }

  if (!template_key || !data || !actualRecipient) {
    return res.status(400).json({ 
      error: 'Missing required fields: template_key, data, to_email' 
    });
  }

  const emailEnabled = process.env.SENDGRID_ENABLED !== 'false';
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@home2smart.com';

  try {
    // Check if user has opted out of emails
    if (user_id) {
      const { data: userData } = await supabase
        .from('h2s_users')
        .select('email_unsubscribed')
        .eq('id', user_id)
        .single();

      if (userData?.email_unsubscribed) {
        console.log(`User ${user_id} has unsubscribed from emails`);
        return res.json({ 
          ok: true, 
          skipped: true, 
          reason: 'user_unsubscribed' 
        });
      }
    }

    // Fetch template from database
    const { data: template, error: templateError } = await supabase
      .from('h2s_email_templates')
      .select('*')
      .eq('template_key', template_key)
      .eq('is_active', true)
      .single();

    if (templateError || !template) {
      console.error('Template not found:', template_key);
      return res.status(404).json({ error: `Template ${template_key} not found` });
    }

    // Render template with data
    let subject = renderTemplate(template.subject, data);
    const htmlBody = renderTemplate(template.html_body, data);
    const textBody = renderTemplate(template.html_body, data);

    // Add test prefix if debug mode
    if (debug === true && process.env.DEBUG_FIRE_KEY) {
      subject = `[TEST:${template_key}] ${subject}`;
    }

    // Log email to database BEFORE sending
    const { data: emailRecord, error: logError } = await supabase
      .from('email_messages')
      .insert({
        to_email: actualRecipient,
        from_email: fromEmail,
        subject,
        html_body: htmlBody,
        text_body: textBody,
        message_type: template_key,
        order_id,
        user_id,
        status: emailEnabled ? 'pending' : 'disabled'
      })
      .select()
      .single();

    if (logError) {
      console.error('Error logging email:', logError);
    }

    // Send email if enabled
    if (emailEnabled) {
      const msg = {
        to: actualRecipient,
        from: fromEmail,
        subject,
        text: textBody,
        html: htmlBody,
      };

      const sendResult = await sgMail.send(msg);
      const messageId = sendResult[0]?.headers?.['x-message-id'];

      // Update email record with SendGrid message ID and success status
      if (emailRecord?.id) {
        await supabase
          .from('email_messages')
          .update({
            message_id: messageId,
            status: 'sent',
            sent_at: new Date().toISOString()
          })
          .eq('id', emailRecord.id);
      }

      // Update order last_email_sent_at if order_id provided
      if (order_id) {
        await supabase
          .from('h2s_orders')
          .update({
            last_email_sent_at: new Date().toISOString(),
            last_email_type: template_key
          })
          .eq('id', order_id);
      }

      console.log(`✅ Email sent via ${template_key} to ${actualRecipient}`);
      return res.json({ 
        ok: true, 
        message_id: messageId,
        template_key,
        to: actualRecipient 
      });
    } else {
      console.log(`📧 Email queued (disabled): ${template_key} to ${actualRecipient}`);
      return res.json({ 
        ok: true, 
        queued: true, 
        message: 'Email logged but not sent (SENDGRID_ENABLED=false)' 
      });
    }

  } catch (error) {
    console.error('Error sending email:', error);

    // Log error to database
    if (emailRecord?.id) {
      await supabase
        .from('email_messages')
        .update({
          status: 'failed',
          error_message: error.message
        })
        .eq('id', emailRecord.id);
    }

    return res.status(500).json({ 
      error: 'Failed to send email', 
      details: error.message 
    });
  }
}
