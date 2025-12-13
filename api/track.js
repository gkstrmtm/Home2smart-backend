import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role for full access
);

/**
 * Hash IP + user-agent for uniqueness without storing raw IP
 */
function hashIpAndUA(ip, userAgent) {
  if (!ip || !userAgent) return null;
  const combined = `${ip}|${userAgent}`;
  return createHash('sha256').update(combined).digest('hex').substring(0, 32);
}

/**
 * Extract UTM params from URL or payload
 */
function extractUTM(url, payload = {}) {
  try {
    const urlObj = new URL(url);
    return {
      utm_source: payload.utm_source || urlObj.searchParams.get('utm_source') || null,
      utm_medium: payload.utm_medium || urlObj.searchParams.get('utm_medium') || null,
      utm_campaign: payload.utm_campaign || urlObj.searchParams.get('utm_campaign') || null,
      utm_term: payload.utm_term || urlObj.searchParams.get('utm_term') || null,
      utm_content: payload.utm_content || urlObj.searchParams.get('utm_content') || null
    };
  } catch {
    return {
      utm_source: payload.utm_source || null,
      utm_medium: payload.utm_medium || null,
      utm_campaign: payload.utm_campaign || null,
      utm_term: payload.utm_term || null,
      utm_content: payload.utm_content || null
    };
  }
}

/**
 * Generate dedupe key for idempotency
 */
function generateDedupeKey(sessionId, eventType, pagePath, elementId, occurredAt) {
  const minuteBucket = new Date(occurredAt).toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
  const parts = [sessionId, eventType, pagePath || '', elementId || '', minuteBucket].filter(Boolean);
  return createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 32);
}

/**
 * Get or create visitor
 */
async function getOrCreateVisitor(visitorId, payload, referrer, userAgent) {
  const utm = extractUTM(payload.url || payload.page_url || '', payload);
  const now = new Date().toISOString();
  
  if (visitorId) {
    // Update existing visitor
    const { data: existing } = await supabase
      .from('h2s_tracking_visitors')
      .select('visitor_id')
      .eq('visitor_id', visitorId)
      .single();
    
    if (existing) {
      // Update last_seen_at and last UTM/referrer
      await supabase
        .from('h2s_tracking_visitors')
        .update({
          last_seen_at: now,
          last_utm_source: utm.utm_source || null,
          last_utm_medium: utm.utm_medium || null,
          last_utm_campaign: utm.utm_campaign || null,
          last_utm_term: utm.utm_term || null,
          last_utm_content: utm.utm_content || null,
          last_referrer: referrer || null,
          updated_at: now
        })
        .eq('visitor_id', visitorId);
      
      return visitorId;
    }
  }
  
  // Create new visitor
  const newVisitorId = visitorId || randomUUID();
  const deviceType = /mobile|android|iphone|ipad/i.test(userAgent || '') ? 'mobile' : 
                     /tablet|ipad/i.test(userAgent || '') ? 'tablet' : 'desktop';
  
  await supabase
    .from('h2s_tracking_visitors')
    .insert({
      visitor_id: newVisitorId,
      first_seen_at: now,
      last_seen_at: now,
      first_utm_source: utm.utm_source || null,
      first_utm_medium: utm.utm_medium || null,
      first_utm_campaign: utm.utm_campaign || null,
      first_utm_term: utm.utm_term || null,
      first_utm_content: utm.utm_content || null,
      last_utm_source: utm.utm_source || null,
      last_utm_medium: utm.utm_medium || null,
      last_utm_campaign: utm.utm_campaign || null,
      last_utm_term: utm.utm_term || null,
      last_utm_content: utm.utm_content || null,
      first_referrer: referrer || null,
      last_referrer: referrer || null,
      user_agent: userAgent || null,
      device_type: deviceType
    });
  
  return newVisitorId;
}

/**
 * Get or create session
 */
async function getOrCreateSession(sessionId, visitorId, landingUrl, landingPath, ipHash) {
  const now = new Date().toISOString();
  
  if (sessionId) {
    const { data: existing } = await supabase
      .from('h2s_tracking_sessions')
      .select('session_id')
      .eq('session_id', sessionId)
      .single();
    
    if (existing) {
      // Update last_event_at
      await supabase
        .from('h2s_tracking_sessions')
        .update({ last_event_at: now, updated_at: now })
        .eq('session_id', sessionId);
      
      return sessionId;
    }
  }
  
  // Create new session
  const newSessionId = sessionId || randomUUID();
  await supabase
    .from('h2s_tracking_sessions')
    .insert({
      session_id: newSessionId,
      visitor_id: visitorId,
      started_at: now,
      last_event_at: now,
      landing_page_url: landingUrl || '',
      landing_path: landingPath || null,
      ip_hash: ipHash || null
    });
  
  return newSessionId;
}

/**
 * Intelligently link event to business entities (orders, jobs, customers)
 * Extracts order_id, job_id, customer_email from metadata and looks up related data
 */
async function linkBusinessEntities(payload, metadata) {
  const links = {
    order_id: null,
    job_id: null,
    customer_email: null,
    customer_phone: null,
    revenue_amount: null
  };
  
  // Extract from metadata or payload
  const orderId = metadata.order_id || payload.order_id || metadata.stripe_session_id || null;
  const jobId = metadata.job_id || payload.job_id || null;
  const customerEmail = metadata.customer_email || payload.customer_email || metadata.email || payload.email || null;
  const customerPhone = metadata.customer_phone || payload.customer_phone || metadata.phone || payload.phone || null;
  
  // Look up order if order_id present
  if (orderId) {
    try {
      const { data: order } = await supabase
        .from('h2s_orders')
        .select('id, customer_email, customer_phone, total_price, subtotal, status')
        .eq('id', orderId)
        .single();
      
      if (order) {
        links.order_id = order.id;
        links.customer_email = order.customer_email || customerEmail;
        links.customer_phone = order.customer_phone || customerPhone;
        // Revenue from order
        links.revenue_amount = parseFloat(order.total_price || order.subtotal || 0);
      }
    } catch (err) {
      console.warn('[Track] Order lookup failed:', err.message);
    }
  }
  
  // Look up job if job_id present
  if (jobId) {
    try {
      const { data: job } = await supabase
        .from('h2s_dispatch_jobs')
        .select('job_id, order_id, customer_email, customer_phone, total_price, status')
        .eq('job_id', jobId)
        .single();
      
      if (job) {
        links.job_id = job.job_id;
        links.order_id = job.order_id || links.order_id;
        links.customer_email = job.customer_email || links.customer_email || customerEmail;
        links.customer_phone = job.customer_phone || links.customer_phone || customerPhone;
        // Revenue from job if not already set from order
        if (!links.revenue_amount && job.total_price) {
          links.revenue_amount = parseFloat(job.total_price);
        }
      }
    } catch (err) {
      console.warn('[Track] Job lookup failed:', err.message);
    }
  }
  
  // If we have customer_email but no order/job, try to find recent order
  if (customerEmail && !links.order_id && !links.job_id) {
    try {
      const { data: recentOrder } = await supabase
        .from('h2s_orders')
        .select('id, customer_email, total_price, created_at')
        .eq('customer_email', customerEmail)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (recentOrder) {
        // Only link if order was created in last 24 hours (likely same session)
        const orderAge = Date.now() - new Date(recentOrder.created_at).getTime();
        if (orderAge < 24 * 60 * 60 * 1000) {
          links.order_id = recentOrder.id;
          links.customer_email = recentOrder.customer_email;
          links.revenue_amount = parseFloat(recentOrder.total_price || 0);
        }
      }
    } catch (err) {
      // No recent order found, that's fine
    }
  }
  
  // Set customer_email/phone from payload if not found via lookup
  if (!links.customer_email && customerEmail) {
    links.customer_email = customerEmail;
  }
  if (!links.customer_phone && customerPhone) {
    links.customer_phone = customerPhone;
  }
  
  return links;
}

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
    const payload = req.body;
    
    // Validate required fields
    if (!payload.event_type && !payload.event) {
      return res.status(400).json({ error: 'Missing event_type or event' });
    }
    
    const eventType = payload.event_type || payload.event;
    const pageUrl = payload.page_url || payload.url || '';
    const pagePath = payload.page_path || (pageUrl ? new URL(pageUrl).pathname : null);
    const occurredAt = payload.occurred_at || payload.timestamp || new Date().toISOString();
    
    // Extract identifiers
    const visitorId = payload.visitor_id || null;
    const sessionId = payload.session_id || null;
    const referrer = payload.referrer || req.headers.referer || null;
    const userAgent = payload.user_agent || req.headers['user-agent'] || null;
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.headers['x-real-ip'] || null;
    const ipHash = ip ? hashIpAndUA(ip, userAgent) : null;
    
    // Extract UTM params
    const utm = extractUTM(pageUrl, payload);
    
    // Generate dedupe key
    const dedupeKey = payload.dedupe_key || generateDedupeKey(
      sessionId || 'unknown',
      eventType,
      pagePath,
      payload.element_id || null,
      occurredAt
    );
    
    // Check for duplicate (idempotency)
    const { data: existingEvent } = await supabase
      .from('h2s_tracking_events')
      .select('event_id')
      .eq('dedupe_key', dedupeKey)
      .single();
    
    if (existingEvent) {
      return res.status(200).json({ ok: true, event_id: existingEvent.event_id, deduped: true });
    }
    
    // Get or create visitor
    const finalVisitorId = await getOrCreateVisitor(visitorId, payload, referrer, userAgent);
    
    // Get or create session
    const finalSessionId = await getOrCreateSession(sessionId, finalVisitorId, pageUrl, pagePath, ipHash);
    
    // Intelligently link to business entities (orders, jobs, customers, revenue)
    const metadata = payload.metadata || payload || {};
    const businessLinks = await linkBusinessEntities(payload, metadata);
    
    // Auto-create attribution record for conversion events
    let attributionId = null;
    if (['purchase', 'purchase_intent', 'job_created', 'order_created', 'checkout_completed'].includes(eventType)) {
      try {
        const { data: attribution } = await supabase
          .from('h2s_tracking_funnel_attribution')
          .insert({
            visitor_id: finalVisitorId,
            session_id: finalSessionId,
            order_id: businessLinks.order_id,
            job_id: businessLinks.job_id,
            customer_id: businessLinks.customer_email, // Using email as customer identifier
            conversion_type: eventType,
            conversion_value: businessLinks.revenue_amount,
            attribution_snapshot: {
              utm_source: utm.utm_source,
              utm_medium: utm.utm_medium,
              utm_campaign: utm.utm_campaign,
              utm_term: utm.utm_term,
              utm_content: utm.utm_content,
              referrer: referrer,
              page_path: pagePath,
              page_url: pageUrl
            }
          })
          .select('attribution_id')
          .single();
        
        if (attribution) {
          attributionId = attribution.attribution_id;
        }
      } catch (attrErr) {
        console.warn('[Track] Attribution creation failed (non-critical):', attrErr.message);
      }
    }
    
    // Insert event with business entity links
    const { data: eventData, error: eventError } = await supabase
      .from('h2s_tracking_events')
      .insert({
        occurred_at: occurredAt,
        visitor_id: finalVisitorId,
        session_id: finalSessionId,
        page_url: pageUrl,
        page_path: pagePath,
        event_type: eventType,
        element_id: payload.element_id || null,
        element_text: payload.element_text || null,
        metadata: metadata,
        utm_source: utm.utm_source,
        utm_medium: utm.utm_medium,
        utm_campaign: utm.utm_campaign,
        utm_term: utm.utm_term,
        utm_content: utm.utm_content,
        referrer: referrer,
        dedupe_key: dedupeKey,
        // Business entity links (auto-populated)
        order_id: businessLinks.order_id,
        job_id: businessLinks.job_id,
        customer_email: businessLinks.customer_email,
        customer_phone: businessLinks.customer_phone,
        revenue_amount: businessLinks.revenue_amount
      })
      .select('event_id')
      .single();
    
    if (eventError) {
      console.error('[Track] Event insert error:', eventError);
      return res.status(500).json({ error: 'Failed to store event', details: eventError.message });
    }
    
    return res.status(200).json({ 
      ok: true, 
      event_id: eventData.event_id,
      visitor_id: finalVisitorId,
      session_id: finalSessionId,
      deduped: false,
      attribution_id: attributionId || null,
      business_links: {
        order_id: businessLinks.order_id,
        job_id: businessLinks.job_id,
        customer_email: businessLinks.customer_email ? '***' : null, // Masked for privacy
        revenue_amount: businessLinks.revenue_amount
      }
    });
    
  } catch (error) {
    console.error('[Track] Error:', error);
    return res.status(500).json({ error: 'Internal error', message: error.message });
  }
}
