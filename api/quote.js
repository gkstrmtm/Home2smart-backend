// Quote Request API - Captures custom installation quotes
// Endpoint: /api/quote

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Validate environment
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase credentials');
    }

    // Parse request body
    const { name, email, phone, details, package_type, source } = req.body;

    // Validation
    if (!name || !email || !phone) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing required fields: name, email, phone' 
      });
    }

    if (!email.includes('@')) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid email address' 
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Insert quote request into database
    const { data: quote, error: insertError } = await supabase
      .from('h2s_quote_requests')
      .insert({
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        project_details: details || '',
        package_type: package_type || 'custom',
        source: source || '/shop',
        status: 'new',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Quote API] Database error:', insertError);
      throw new Error('Failed to save quote request');
    }

    console.log('[Quote API] Quote saved:', quote.quote_id);

    // Send email notification (if configured)
    if (process.env.QUOTE_NOTIFICATION_EMAIL) {
      try {
        await sendEmailNotification({
          to: process.env.QUOTE_NOTIFICATION_EMAIL,
          quote: {
            id: quote.quote_id,
            name,
            email,
            phone,
            details,
            package_type,
            created_at: quote.created_at
          }
        });
        console.log('[Quote API] Email notification sent');
      } catch (emailError) {
        console.error('[Quote API] Email notification failed:', emailError);
        // Don't fail the request if email fails
      }
    }

    // Optional: Webhook to Go High Level or other CRM
    if (process.env.GHL_WEBHOOK_URL) {
      try {
        await fetch(process.env.GHL_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            phone,
            notes: details,
            source: 'Shop Quote Request',
            customField: {
              package_type,
              quote_id: quote.quote_id
            }
          })
        });
        console.log('[Quote API] GHL webhook sent');
      } catch (webhookError) {
        console.error('[Quote API] GHL webhook failed:', webhookError);
        // Don't fail the request if webhook fails
      }
    }

    return res.status(200).json({
      ok: true,
      quote_id: quote.quote_id,
      message: 'Quote request received. We\'ll contact you within 1 hour.'
    });

  } catch (error) {
    console.error('[Quote API] Error:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Failed to process quote request. Please try again.'
    });
  }
}

// Email notification helper (using fetch to external service)
async function sendEmailNotification({ to, quote }) {
  // Using simple email service (you can replace with SendGrid, Resend, etc.)
  const emailBody = `
New Quote Request #${quote.id}

Customer: ${quote.name}
Email: ${quote.email}
Phone: ${quote.phone}
Package Type: ${quote.package_type}

Project Details:
${quote.details || 'No details provided'}

Submitted: ${new Date(quote.created_at).toLocaleString()}

---
View in dashboard or call customer ASAP!
  `.trim();

  // For now, just log (you'll need to configure an email service)
  console.log('[Email] Would send to:', to);
  console.log('[Email] Subject: New Quote Request #' + quote.id);
  console.log('[Email] Body:', emailBody);
  
  // TODO: Integrate with your email service
  // Example with Resend:
  // const response = await fetch('https://api.resend.com/emails', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
  //     'Content-Type': 'application/json'
  //   },
  //   body: JSON.stringify({
  //     from: 'quotes@home2smart.com',
  //     to: [to],
  //     subject: `New Quote Request #${quote.id} - ${quote.name}`,
  //     text: emailBody
  //   })
  // });
}
