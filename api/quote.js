// Quote Request API - Captures custom installation quotes
// Endpoint: /api/quote

import { createClient } from '@supabase/supabase-js';
import sgMail from '@sendgrid/mail';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// Email configuration
const SENDGRID_CONFIG = {
  fromEmail: "contact@home2smart.com",
  fromName: "Home2Smart",
  replyTo: "contact@home2smart.com",
  quoteNotifications: "dispatch@home2smart.com"
};

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
    // Use Service Role Key to bypass RLS for backend operations
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    
    if (!process.env.SUPABASE_URL || !supabaseKey) {
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
      supabaseKey
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
      // Return specific database error for debugging
      throw new Error(`Database error: ${insertError.message || JSON.stringify(insertError)}`);
    }

    console.log('[Quote API] Quote saved:', quote.quote_id);

    // === NOTIFY MANAGEMENT OF QUOTE REQUEST ===
    // This handles both SMS and Email notifications via the central notification service
    try {
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : 'https://h2s-backend.vercel.app';
        
      await fetch(`${baseUrl}/api/notify-management`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'quoteRequest',
          data: {
            customerName: name,
            email: email, // Added email for template
            phone: phone,
            service: package_type,
            details: details
          }
        })
      });
      console.log('[Quote API] Management notification sent');
    } catch (mgmtError) {
      console.error('[Quote API] Management notification failed (non-critical):', mgmtError);
    }

    // Send to GoHighLevel CRM
    if (process.env.GHL_WEBHOOK_URL) {
      try {
        const ghlResponse = await fetch(process.env.GHL_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: name.split(' ')[0],
            lastName: name.split(' ').slice(1).join(' ') || name,
            email,
            phone,
            source: 'Website - Custom Quote',
            tags: ['quote-request', package_type.toLowerCase().replace(/\s+/g, '-')],
            customFields: {
              package_type,
              quote_id: quote.quote_id,
              project_details: details,
              quote_date: new Date().toISOString()
            },
            notes: `Custom Quote Request\n\nPackage: ${package_type}\n\nProject Details:\n${details || 'No details provided'}\n\nQuote ID: ${quote.quote_id}`
          })
        });
        
        if (ghlResponse.ok) {
          console.log('[Quote API] GHL contact created successfully');
        } else {
          const errorText = await ghlResponse.text();
          console.error('[Quote API] GHL webhook failed:', errorText);
        }
      } catch (webhookError) {
        console.error('[Quote API] GHL webhook failed:', webhookError.message);
        // Don't fail the request if webhook fails
      }
    }

    // === NOTIFY MANAGEMENT OF QUOTE REQUEST ===
    // This handles both SMS and Email notifications via the central notification service
    try {
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : 'https://h2s-backend.vercel.app';
        
      await fetch(`${baseUrl}/api/notify-management`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'quoteRequest',
          data: {
            customerName: name,
            email: email, // Added email for template
            phone: phone,
            service: package_type,
            details: details
          }
        })
      });
      console.log('[Quote API] Management notification sent');
    } catch (mgmtError) {
      console.error('[Quote API] Management notification failed (non-critical):', mgmtError);
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
      error: error.message, // Expose full error message for debugging
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
