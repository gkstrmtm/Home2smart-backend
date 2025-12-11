// Central API for sending management/internal notifications
// Handles SMS + Email to management team for critical events
// REFACTORED: Direct integration (no internal API calls) + Embedded Templates

import { MANAGEMENT_CONTACTS, SMS_TEMPLATES, EMAIL_TEMPLATES } from './config/notifications.js';
import twilio from 'twilio';
import sgMail from '@sendgrid/mail';

// Initialize Clients
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, data } = req.body;

  if (!type || !data) {
    return res.status(400).json({ 
      error: 'Missing required fields: type, data' 
    });
  }

  try {
    const results = {
      type,
      sms: [],
      email: []
    };

    // Determine if this notification type is enabled
    // Map 'quoteRequest' -> 'quoteRequests' (plural in config)
    const configKey = type === 'quoteRequest' ? 'quoteRequests' : type;
    const notificationEnabled = MANAGEMENT_CONTACTS.notifications[configKey] !== false; // Default to true if undefined

    if (!notificationEnabled) {
      console.log(`[Notify Management] ${type} notifications disabled`);
      return res.json({ 
        ok: true, 
        skipped: true, 
        reason: 'notification_type_disabled' 
      });
    }

    // Get template key based on notification type
    const templateKey = `mgmt_${type.replace(/([A-Z])/g, '_$1').toLowerCase()}`;
    
    // --- 1. SEND SMS (Directly via Twilio) ---
    if (MANAGEMENT_CONTACTS.phones && MANAGEMENT_CONTACTS.phones.length > 0) {
      // Deduplicate phone numbers
      const uniquePhones = [...new Set(MANAGEMENT_CONTACTS.phones)];
      
      // Resolve SMS Message
      let smsMessage = '';
      if (SMS_TEMPLATES[templateKey]) {
        smsMessage = SMS_TEMPLATES[templateKey].message;
        Object.keys(data).forEach(k => {
          smsMessage = smsMessage.replace(new RegExp(`{${k}}`, 'g'), data[k] || '');
        });
      } else {
        // Fallback generic message
        smsMessage = `Alert: ${type} - ${JSON.stringify(data)}`;
      }

      for (const phone of uniquePhones) {
        try {
          const message = await twilioClient.messages.create({
            body: smsMessage,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phone
          });

          results.sms.push({ 
            phone, 
            success: true,
            sid: message.sid 
          });
          console.log(`[Notify Management] SMS sent to ${phone}`);
        } catch (err) {
          console.error(`[Notify Management] SMS failed for ${phone}:`, err.message);
          results.sms.push({ 
            phone, 
            success: false, 
            error: err.message 
          });
        }
      }
    }

    // --- 2. SEND EMAIL (Directly via SendGrid) ---
    if (process.env.SENDGRID_API_KEY && MANAGEMENT_CONTACTS.emails && MANAGEMENT_CONTACTS.emails.length > 0) {
      // Resolve Email Content
      const templateConfig = EMAIL_TEMPLATES[templateKey] || {
        subject: `Management Alert: ${type}`,
        fromEmail: 'dispatch@home2smart.com',
        fromName: 'H2S Dispatch'
      };

      let subject = templateConfig.subject;
      Object.keys(data).forEach(k => {
        subject = subject.replace(new RegExp(`{${k}}`, 'g'), data[k] || '');
      });

      // Generate HTML Body (Embedded Logic)
      let htmlBody = '';
      
      if (templateConfig.html) {
        // Use template from config if available
        htmlBody = templateConfig.html;
        Object.keys(data).forEach(k => {
          htmlBody = htmlBody.replace(new RegExp(`{${k}}`, 'g'), data[k] || '');
        });
      } else if (type === 'quoteRequest') {
        // Fallback hardcoded template for quotes (if not in config)
        htmlBody = `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd;">
            <h2 style="color: #d32f2f;">📋 New Quote Request</h2>
            <p><strong>Customer:</strong> ${data.customerName}</p>
            <p><strong>Phone:</strong> <a href="tel:${data.phone}">${data.phone}</a></p>
            <p><strong>Service:</strong> ${data.service}</p>
            <div style="background: #f5f5f5; padding: 10px; margin-top: 10px;">
              <strong>Details:</strong><br/>
              ${data.details}
            </div>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">
              Sent from Home2Smart Dispatch System
            </p>
          </div>
        `;
      } else {
        // Generic Fallback HTML
        htmlBody = `
          <div style="font-family: Arial, sans-serif;">
            <h2>Management Alert: ${type}</h2>
            <pre>${JSON.stringify(data, null, 2)}</pre>
          </div>
        `;
      }

      const msg = {
        to: MANAGEMENT_CONTACTS.emails, // SendGrid supports array of emails
        from: {
          email: templateConfig.fromEmail,
          name: templateConfig.fromName
        },
        subject: subject,
        html: htmlBody,
        text: `Management Alert: ${type}\n\n${JSON.stringify(data, null, 2)}`
      };

      try {
        await sgMail.sendMultiple(msg);
        results.email.push({ success: true, recipients: MANAGEMENT_CONTACTS.emails.length });
        console.log(`[Notify Management] Emails sent to ${MANAGEMENT_CONTACTS.emails.length} recipients`);
      } catch (err) {
        console.error('[Notify Management] Email failed:', err);
        results.email.push({ success: false, error: err.message });
      }
    }

    return res.json({
      ok: true,
      type,
      results
    });

  } catch (error) {
    console.error('[Notify Management] Error:', error);
    return res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
}
