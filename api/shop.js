import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import crypto from 'crypto';

// Cache catalog in memory for 15 minutes (increased from 5)
let catalogCache = null;
let cacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Helper to parse request body
async function parseBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body; // Already parsed by Vercel
  }
  
  // Manual parsing if needed
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

export default async function handler(req, res) {
  // CORS headers
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validate environment variables
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[Shop API] Missing STRIPE_SECRET_KEY');
    return res.status(500).json({ ok: false, error: 'Server configuration error: Missing Stripe key' });
  }
  
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[Shop API] Missing Supabase credentials');
    return res.status(500).json({ ok: false, error: 'Server configuration error: Missing Supabase credentials' });
  }

  // Initialize clients
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Parse body for POST requests
  let body = {};
  if (req.method === 'POST') {
    try {
      body = await parseBody(req);
    } catch (error) {
      console.error('[Shop API] Failed to parse body:', error);
      return res.status(400).json({ ok: false, error: 'Invalid JSON in request body' });
    }
  }

  const action = req.query.action || body.__action || '';

  try {
    // ===== CATALOG =====
    if (action === 'catalog' && req.method === 'GET') {
      return handleCatalog(req, res, supabase);
    }

    // ===== CHECKOUT =====
    if ((action === 'create_session' || action === 'create_checkout_session') && req.method === 'POST') {
      // If client sent direct line_items, honor them; else build from cart
      if (Array.isArray(body.line_items) && body.line_items.length) {
        return handleDirectCheckout(req, res, stripe, body);
      }
      return handleCheckout(req, res, stripe, supabase, body);
    }

    // ===== CUSTOMER AUTH/PROFILE =====
    if (action === 'create_user' && req.method === 'POST') {
      return handleCreateUser(req, res, supabase, body);
    }
    if (action === 'signin' && req.method === 'POST') {
      return handleSignIn(req, res, supabase, body);
    }
    if (action === 'request_password_reset' && req.method === 'POST') {
      return handleRequestPasswordReset(req, res, supabase, body);
    }
    if (action === 'reset_password' && req.method === 'POST') {
      return handleResetPassword(req, res, supabase, body);
    }
    if (action === 'change_password' && req.method === 'POST') {
      return handleChangePassword(req, res, supabase, body);
    }
    if (action === 'upsert_user' && req.method === 'POST') {
      return handleUpsertUser(req, res, supabase, body);
    }
    if (action === 'user' && req.method === 'GET') {
      return handleGetUser(req, res, supabase, req.query.email||'');
    }
    if (action === 'orders' && req.method === 'GET') {
      return handleGetOrders(req, res, supabase, req.query.email||'');
    }

    // ===== DEBUG: FIND ORDER BY SESSION_ID =====
    if (action === 'find_order' && req.method === 'GET') {
      const sid = String(req.query.session_id||'').trim();
      if(!sid){ return res.status(400).json({ ok:false, error:'Missing session_id' }); }
      try{
        const { data, error } = await supabase
          .from('h2s_orders')
          .select('*')
          .eq('stripe_session_id', sid)
          .limit(1)
          .maybeSingle();
        if(error){ return res.status(500).json({ ok:false, error:error.message }); }
        if(!data){ return res.status(404).json({ ok:false, error:'Order not found for session_id' }); }
        return res.status(200).json({ ok:true, order:data });
      }catch(e){
        return res.status(500).json({ ok:false, error: e.message||'debug error' });
      }
    }

    // ===== ORDER RETRIEVAL =====
    if (action === 'orderpack' && req.method === 'GET') {
      return handleOrderPack(req, res, supabase, req.query.session_id||'');
    }
    if (action === 'mark_session' && req.method === 'POST') {
      // Just log that success page was reached - no action needed
      console.log('[MarkSession]', body.session_id, body.status, body.note);
      return res.status(200).json({ ok: true });
    }

    // ===== PROMO CHECK AGAINST CART =====
    if (action === 'promo_check_cart' && req.method === 'POST') {
      return handlePromoCheckCart(req, res, stripe, body);
    }

    // ===== DIAGNOSTIC: test promo code match (no secret leaked) =====
    if (action === 'test_promo_check' && req.method === 'GET') {
      const code = String(req.query.code||'').trim();
        const testPromo = (process.env.SHOP_TEST_PROMO_CODE || '').trim();
      const present = !!testPromo;
      const match = present && code === testPromo;
      return res.status(200).json({ ok:true, present, match });
    }

    return res.status(400).json({
      ok: false,
      error: 'Unknown action or invalid method',
      action,
      method: req.method
    });

  } catch (error) {
    console.error('[Shop API] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// ===== CATALOG HANDLER =====
async function handleCatalog(req, res, supabase) {
  try {
    // Check cache first
    const now = Date.now();
    if (catalogCache && (now - cacheTime) < CACHE_TTL) {
      return res.status(200).json({
        ok: true,
        catalog: catalogCache,
        cached: true
      });
    }

    // Load catalog from Supabase in parallel
    const [
      { data: services, error: servicesError },
      { data: bundles, error: bundlesError },
      { data: priceTiers, error: tiersError },
      { data: serviceOptions, error: optionsError },
      { data: bundleItems, error: itemsError }
    ] = await Promise.all([
      supabase.from('h2s_services').select('*').order('service_id'),
      supabase.from('h2s_bundles').select('*').eq('active', true).order('bundle_id'),
      supabase.from('h2s_pricetiers').select('*').order('service_id, min_qty'),
      supabase.from('h2s_serviceoptions').select('*').order('service_id, option_id'),
      supabase.from('h2s_bundleitems').select('*').order('bundle_id, service_id')
    ]);

    // Check for errors
    const errors = [
      servicesError && 'services: ' + servicesError.message,
      bundlesError && 'bundles: ' + bundlesError.message,
      tiersError && 'priceTiers: ' + tiersError.message,
      optionsError && 'serviceOptions: ' + optionsError.message,
      itemsError && 'bundleItems: ' + itemsError.message
    ].filter(Boolean);

    if (errors.length > 0) {
      console.error('[Catalog] Load errors:', errors);
      return res.status(500).json({
        ok: false,
        error: 'Failed to load catalog',
        details: errors
      });
    }

    // Build catalog object
    const catalog = {
      services: services || [],
      bundles: bundles || [],
      priceTiers: priceTiers || [],
      serviceOptions: serviceOptions || [],
      bundleItems: bundleItems || [],
      recommendations: [],
      memberships: [],
      membershipPrices: [],
      config: { currency: 'usd' }
    };

    // Update cache
    catalogCache = catalog;
    cacheTime = now;

    console.log('[Catalog] Loaded:', {
      services: catalog.services.length,
      bundles: catalog.bundles.length,
      priceTiers: catalog.priceTiers.length
    });

    // Aggressive CDN caching: 15 min fresh, 24 hours stale-while-revalidate
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400, max-age=300');

    return res.status(200).json({
      ok: true,
      catalog,
      cached: false
    });

  } catch (error) {
    console.error('[Catalog] Error:', error);
    
    // If we have stale cache, return it with warning
    if (catalogCache) {
      return res.status(200).json({
        ok: true,
        catalog: catalogCache,
        cached: true,
        stale: true,
        error: error.message
      });
    }

    throw error;
  }
}

// ===== CHECKOUT HANDLER =====
async function handleCheckout(req, res, stripe, supabase, body) {
  try {
    const { customer, cart, source, success_url, cancel_url, metadata } = body;

    // Validate input
    if (!customer?.email) {
      return res.status(400).json({ ok: false, error: 'Customer email required' });
    }

    if (!cart || cart.length === 0) {
      return res.status(400).json({ ok: false, error: 'Cart is empty' });
    }

    // Generate order ID
    const orderId = generateOrderId();

    // Build line items from cart
    const lineItems = [];
    const receiptItems = [];

    for (const item of cart) {

      // HARDWARE / ADD-ONS (No DB lookup needed)
      if (item.id === 'mount_hardware') {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: 'TV Wall Mount (Hardware)' },
            unit_amount: 3900, // $39.00
          },
          quantity: item.qty || 1
        });
        receiptItems.push({
          name: 'TV Wall Mount (Hardware)',
          qty: item.qty || 1,
          price: 3900
        });
        continue;
      }
      if (item.id === 'tv_multi_4th') {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: '4th TV Add-on (Service)' },
            unit_amount: 10000, // $100.00
          },
          quantity: item.qty || 1
        });
        receiptItems.push({
          name: '4th TV Add-on (Service)',
          qty: item.qty || 1,
          price: 10000
        });
        continue;
      }

      if (item.type === 'bundle') {
        // Look up bundle in database
        const { data: bundle, error } = await supabase
          .from('h2s_bundles')
          .select('*')
          .eq('bundle_id', item.bundle_id)
          .single();

        if (error || !bundle) {
          console.error('[Checkout] Bundle not found:', item.bundle_id);
          return res.status(400).json({
            ok: false,
            error: `Bundle not found: ${item.bundle_id}`
          });
        }

        if (!bundle.stripe_price_id) {
          console.error('[Checkout] Bundle missing stripe_price_id:', item.bundle_id);
          return res.status(400).json({
            ok: false,
            error: `Bundle ${bundle.name || item.bundle_id} not configured for checkout`
          });
        }

        lineItems.push({
          price: bundle.stripe_price_id,
          quantity: item.qty || 1
        });
        
        receiptItems.push({
          name: bundle.name || item.name || 'Bundle',
          qty: item.qty || 1,
          price: Math.round(Number(bundle.price||0)*100)
        });

      } else if (item.service_id) {
        // Fetch ALL tiers for this service
        const { data: allTiers, error } = await supabase
          .from('h2s_pricetiers')
          .select('*')
          .eq('service_id', item.service_id);

        if (error || !allTiers || allTiers.length === 0) {
          console.error('[Checkout] No pricing tiers for:', item.service_id);
          return res.status(400).json({
            ok: false,
            error: `No pricing available for service: ${item.service_id}`
          });
        }

        // Find the right tier using the same logic as Apps Script
        const qty = Number(item.qty || 1);
        const optionId = String(item.option_id || '').toLowerCase();

        const matchingTiers = allTiers.filter(t => {
          const min = Number(t.min_qty || 0);
          const max = (t.max_qty === '' || t.max_qty == null) ? Number.POSITIVE_INFINITY : Number(t.max_qty);
          return qty >= min && qty <= max;
        });

        // Sort tiers: exact option match first, then no option, then other options
        matchingTiers.sort((a, b) => {
          const aOpt = String(a.option_id || '').toLowerCase();
          const bOpt = String(b.option_id || '').toLowerCase();

          const aPref = optionId ? (aOpt === optionId ? 0 : (aOpt ? 2 : 1)) : (aOpt ? 1 : 0);
          const bPref = optionId ? (bOpt === optionId ? 0 : (bOpt ? 2 : 1)) : (bOpt ? 1 : 0);

          if (aPref !== bPref) return aPref - bPref;

          // Prefer narrower tier ranges
          const aSpan = (a.max_qty == null || a.max_qty === '' ? Number.POSITIVE_INFINITY : Number(a.max_qty)) - Number(a.min_qty || 0);
          const bSpan = (b.max_qty == null || b.max_qty === '' ? Number.POSITIVE_INFINITY : Number(b.max_qty)) - Number(b.min_qty || 0);
          return aSpan - bSpan;
        });

        const tier = matchingTiers[0];

        if (!tier || !tier.stripe_price_id) {
          console.error('[Checkout] No valid tier for:', item.service_id, 'qty:', qty);
          return res.status(400).json({
            ok: false,
            error: `No pricing available for ${item.service_id} (qty: ${qty}${item.option_id ? ', option: ' + item.option_id : ''})`
          });
        }

        lineItems.push({
          price: tier.stripe_price_id,
          quantity: qty
        });
        
        receiptItems.push({
          name: item.name || item.service_id || 'Service',
          qty: qty,
          price: Math.round(Number(tier.unit_price||0)*100)
        });

      } else {
        return res.status(400).json({
          ok: false,
          error: 'Invalid cart item format'
        });
      }
    }

    if (lineItems.length === 0) {
      return res.status(400).json({ ok: false, error: 'No valid items in cart' });
    }

    // Create Stripe checkout session
    const frontendUrl = 'https://home2smart.com';
    const sessionParams = {
      mode: 'payment',
      line_items: lineItems,
      customer_email: customer.email,
      success_url: success_url || `https://home2smart.com/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancel_url || `${frontendUrl}/bundles`,
      shipping_address_collection: {
        allowed_countries: ['US']  // Collect service address
      },
      metadata: {
        ...(metadata || {}),
        source: source || '/shop',
        order_id: orderId,
        customer_name: customer.name || '',
        customer_phone: customer.phone || '',
        cart_items: JSON.stringify(receiptItems)
      },
      allow_promotion_codes: true
    };

    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (stripeError) {
      console.error('[Checkout] Stripe error:', stripeError.message);
      return res.status(500).json({
        ok: false,
        error: 'Payment provider error: ' + (stripeError.message || 'Unknown error')
      });
    }

    // Save order to database - match exact h2s_orders schema
    let insertError = null;
    let dbErrorDetails = null;
    
    try {
      const now = new Date().toISOString();
      
      // Calculate totals from cart
      let subtotal = 0;
      const orderItems = [];
      
      for (const item of cart) {
        let unitPrice = 0;
        
        if (item.id === 'mount_hardware') {
          unitPrice = 39;
        } else if (item.id === 'tv_multi_4th') {
          unitPrice = 100;
        } else if (item.type === 'bundle') {
          const { data: bundle } = await supabase
            .from('h2s_bundles')
            .select('price')
            .eq('bundle_id', item.bundle_id)
            .single();
          unitPrice = Number(bundle?.price || 0);
        } else {
          // Get price from tier
          const { data: tiers } = await supabase
            .from('h2s_pricetiers')
            .select('unit_price')
            .eq('service_id', item.service_id)
            .lte('min_qty', item.qty || 1);
          unitPrice = Number(tiers?.[0]?.unit_price || 0);
        }
        
        const qty = Number(item.qty || 1);
        const lineTotal = unitPrice * qty;
        subtotal += lineTotal;
        
        orderItems.push({
          type: item.type || 'service',
          service_id: item.service_id || null,
          bundle_id: item.bundle_id || null,
          service_name: item.service_name || item.service_id || item.bundle_id,
          qty: qty,
          unit_price: unitPrice,
          line_total: lineTotal,
          option_id: item.option_id || null,
          metadata: item.metadata || {} // Capture item-specific metadata (e.g. mount_provider)
        });
      }
      
      const tax = subtotal * 0.08; // 8% tax
      const total = subtotal + tax;
      
      // Single order record matching exact schema
      const orderRecord = {
        order_id: orderId,
        session_id: session.id,
        payment_intent_id: null, // Will be set by webhook
        customer_email: customer.email,
        customer_name: customer.name || null,
        customer_phone: customer.phone || null,
        phone: customer.phone || null,
        items: JSON.stringify(orderItems),
        subtotal: subtotal.toFixed(2),
        tax: tax.toFixed(2),
        total: total.toFixed(2),
        status: 'pending',
        currency: 'usd',
        
        // Address fields - populated from metadata if available
        address: (metadata?.service_address) || null,
        city: (metadata?.service_city) || null,
        state: (metadata?.service_state) || null,
        zip: (metadata?.service_zip) || null,
        
        // Service details from first item
        service_id: orderItems[0]?.service_id || null,
        service_name: orderItems[0]?.service_name || null,
        qty: orderItems[0]?.qty || 0,
        unit_price: String(orderItems[0]?.unit_price || 0),
        line_total: String(orderItems[0]?.line_total || 0),
        
        // Metadata
        options_selected: '[]',
        metadata_json: metadata || {}, // Capture order-level metadata
        
        // Defaults
        discount_applied: '0',
        discount_amount: '0',
        points_earned: Math.floor(total / 10),
        points_redeemed: 0,
        
        created_at: now,
        updated_at: now
      };
      
      const { error } = await supabase
        .from('h2s_orders')
        .insert(orderRecord);
      
      insertError = error;
      
      if (insertError) {
        console.error('[Checkout] ❌ DB SAVE FAILED');
        console.error('[Checkout] Session ID:', session.id);
        console.error('[Checkout] Error:', insertError.message);
        console.error('[Checkout] Error details:', JSON.stringify(insertError, null, 2));
        console.error('[Checkout] Attempted columns:', Object.keys(orderRecord));
        console.error('[Checkout] Order record:', JSON.stringify(orderRecord, null, 2));
        dbErrorDetails = {
          message: insertError.message,
          code: insertError.code,
          details: insertError.details,
          hint: insertError.hint,
          columns_attempted: Object.keys(orderRecord)
        };
      } else {
        console.log('[Checkout] ✅ ORDER SAVED SUCCESSFULLY');
        console.log('[Checkout] Order ID:', orderId);
        console.log('[Checkout] Session ID:', session.id);
        console.log('[Checkout] Customer:', customer.email);
      }
    } catch (dbErr) {
      console.error('[Checkout] DB save exception:', dbErr.message);
      dbErrorDetails = { message: dbErr.message, stack: dbErr.stack };
    }
    
    return res.status(200).json({
      ok: true,
      pay: {
        session_url: session.url,
        session_id: session.id
      },
      debug: {
        order_created: !insertError && !dbErrorDetails,
        order_id: orderId,
        session_id: session.id,
        error: insertError ? insertError.message : (dbErrorDetails ? dbErrorDetails.message : null),
        db_error_details: dbErrorDetails
      }
    });

  } catch (error) {
    console.error('[Checkout] Unhandled error:', error);
    console.error('[Checkout] Error stack:', error.stack);
    return res.status(500).json({
      ok: false,
      error: error.message || 'Checkout failed',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Direct line_items based checkout (used by deferred module)
async function handleDirectCheckout(req, res, stripe, body){
  try{
    const line_items = Array.isArray(body.line_items) ? body.line_items : [];
    if(!line_items.length){
      return res.status(400).json({ ok:false, error:'Missing line_items' });
    }
    // Secret test promo: simulate checkout without hitting Stripe session
    const TEST_PROMO = process.env.SHOP_TEST_PROMO_CODE || '';
      if (TEST_PROMO && String(body.promotion_code||'').trim() === TEST_PROMO.trim()) {
      // Optional: restrict simulation to specific tester emails
      const allowList = (process.env.SHOP_TEST_EMAIL_ALLOWLIST||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
      if (allowList.length && (!body.customer_email || !allowList.includes(String(body.customer_email).toLowerCase()))) {
        return res.status(403).json({ ok:false, error:'Test promo not permitted for this email' });
      }
      try {
        // Compute subtotal from Stripe prices (read-only) for accurate UI
        const prices = await Promise.all(line_items.map(li => stripe.prices.retrieve(li.price, { expand: ['product'] })));
        let subtotal = 0;
        const parts = [];
        line_items.forEach((li, idx) => {
          const pr = prices[idx];
          const qty = Number(li.quantity||1) || 1;
          const unit = Number(pr?.unit_amount||0);
          subtotal += unit * qty;
          const name = (pr?.product && typeof pr.product === 'object' && pr.product.name) || pr?.nickname || pr?.id || 'Item';
          parts.push(`${qty}× ${name}`);
        });
        const sessionId = `testsess_${crypto.randomBytes(6).toString('hex')}`;
        const orderId   = `test_${Date.now().toString(36)}`;
        
        // CRITICAL: Create order in database for test promo (so appointment booking works)
        const supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        const { data: testOrder, error: orderError } = await supabase
          .from('h2s_orders')
          .insert({
            stripe_session_id: sessionId,
            customer_email: body.customer_email || body.metadata?.customer_email || '',
            customer_name: body.metadata?.customer_name || '',
            customer_phone: body.metadata?.customer_phone || '',
            amount_total: 0, // Free with test promo
            currency: prices[0]?.currency || 'usd',
            status: 'paid', // Mark as paid since it's free
            metadata: {
              ...body.metadata,
              test_promo: TEST_PROMO,
              original_amount: subtotal,
              simulated: true
            },
            created_at: new Date().toISOString()
          })
          .select('order_id')
          .single();
        
        if (orderError) {
          console.error('[TestPromo] Failed to create order:', orderError);
        } else {
          console.log('[TestPromo] ✅ Created test order:', testOrder.order_id);
        }
        
        const successBase = body.success_url || 'https://home2smart.com/success?session_id={CHECKOUT_SESSION_ID}';
        const urlObj = new URL(successBase.replace('{CHECKOUT_SESSION_ID}', sessionId));
        // Enrich with order params the success page already reads
        urlObj.searchParams.set('order_id', orderId);
        urlObj.searchParams.set('order_created_at', new Date().toISOString());
        urlObj.searchParams.set('order_currency', prices[0]?.currency || 'USD');
        urlObj.searchParams.set('order_item_count', String(line_items.reduce((n,li)=> n + Number(li.quantity||1), 0)));
        urlObj.searchParams.set('order_subtotal', (subtotal/100).toFixed(2));
        urlObj.searchParams.set('order_total', '0.00');
        urlObj.searchParams.set('order_summary', parts.join(' | '));
        urlObj.searchParams.set('order_discount_code', TEST_PROMO);
        urlObj.searchParams.set('order_discount_amount', (subtotal/100).toFixed(2));
        try {
          urlObj.searchParams.set('order_lines_json', encodeURIComponent(JSON.stringify(line_items)));
        } catch(_) {}
        return res.status(200).json({ ok:true, pay: { session_url: urlObj.toString(), session_id: sessionId }, simulated:true });
      } catch (e) {
        console.error('[DirectCheckout/TestPromo] Simulation failed:', e);
        return res.status(500).json({ ok:false, error:'Test promo simulation failed' });
      }
    }
    const params = {
      mode: 'payment',
      line_items,
      customer_email: body.customer_email || undefined,
      client_reference_id: body.client_reference_id || undefined,
      success_url: body.success_url || 'https://home2smart.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: body.cancel_url || 'https://home2smart.com/bundles',
      metadata: body.metadata || {}
    };
    // If a specific promotion code (string) was provided, try to attach it
    if (body.promotion_code) {
      try {
        const list = await stripe.promotionCodes.list({ code: body.promotion_code, active: true, limit: 1 });
        const promo = list.data?.[0];
        if (promo) {
          params.discounts = [{ promotion_code: promo.id }];
        }
      } catch(_){ /* ignore and allow checkout without explicit discount */ }
    }
    if(!params.discounts){
      params.allow_promotion_codes = true;
    }
    const session = await stripe.checkout.sessions.create(params);
    return res.status(200).json({ ok:true, pay: { session_url: session.url, session_id: session.id } });
  }catch(err){
    console.error('[DirectCheckout] Error:', err);
    return res.status(500).json({ ok:false, error: err.message || 'Checkout error' });
  }
}

// ===== Simple password hashing helpers =====
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')){
  const iterations = 120000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}
function verifyPassword(password, stored){
  try{
    const [algo, iterStr, salt, hash] = String(stored||'').split('$');
    const iterations = Number(iterStr||'120000');
    const calc = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(calc,'hex'), Buffer.from(hash||'', 'hex'));
  }catch(_){ return false; }
}

async function handleCreateUser(req, res, supabase, body){
  const u = body.user || {};
  if(!u.email || !u.password){ return res.status(400).json({ok:false, error:'Missing email or password'}); }
  const email = String(u.email).trim().toLowerCase();
  const pwHash = hashPassword(String(u.password));
  const user_id = crypto.randomUUID();
  const referral_code = (email.split('@')[0] + Math.random().toString(36).slice(2,6)).slice(0,16).toUpperCase();
  const { data, error } = await supabase.from('h2s_users').insert({
    user_id,
    email,
    password_hash: pwHash,
    full_name: u.name || '',
    phone: u.phone || '',
    referral_code
  }).select('user_id, email, full_name, phone').single();
  if(error){ return res.status(400).json({ ok:false, error: error.message }); }
  return res.status(200).json({ ok:true, user:{ email:data.email, name:data.full_name||'', phone:data.phone||'' } });
}

async function handleSignIn(req, res, supabase, body){
  const email = String(body.email||'').trim().toLowerCase();
  const password = String(body.password||'');
  if(!email || !password) return res.status(400).json({ ok:false, error:'Missing credentials' });
  const { data, error } = await supabase.from('h2s_users').select('email, full_name, phone, password_hash').eq('email', email).single();
  if(error || !data) return res.status(401).json({ ok:false, error:'Invalid email or password' });
  if(!verifyPassword(password, data.password_hash)) return res.status(401).json({ ok:false, error:'Invalid email or password' });
  return res.status(200).json({ ok:true, user:{ email:data.email, name:data.full_name||'', phone:data.phone||'' } });
}

async function handleRequestPasswordReset(req, res, supabase, body){
  const email = String(body.email||'').trim().toLowerCase();
  if(!email) return res.status(400).json({ ok:false, error:'Missing email' });
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now()+24*60*60*1000).toISOString();
  const { error } = await supabase.from('h2s_users').update({ reset_token: token, reset_expires: expires }).eq('email', email);
  if(error) return res.status(400).json({ ok:false, error: error.message });
  return res.status(200).json({ ok:true, token });
}

async function handleResetPassword(req, res, supabase, body){
  const token = String(body.token||'');
  const newpw = String(body.new_password||'');
  if(!token || newpw.length<8) return res.status(400).json({ ok:false, error:'Invalid request' });
  const { data, error } = await supabase.from('h2s_users').select('email, reset_expires').eq('reset_token', token).single();
  if(error || !data) return res.status(400).json({ ok:false, error:'Invalid token' });
  if(data.reset_expires && new Date(data.reset_expires) < new Date()) return res.status(400).json({ ok:false, error:'Token expired' });
  const pwHash = hashPassword(newpw);
  const { error: updErr } = await supabase.from('h2s_users').update({ password_hash: pwHash, reset_token:null, reset_expires:null }).eq('reset_token', token);
  if(updErr) return res.status(400).json({ ok:false, error: updErr.message });
  return res.status(200).json({ ok:true });
}

async function handleChangePassword(req, res, supabase, body){
  const email = String(body.email||'').trim().toLowerCase();
  const oldp = String(body.old_password||'');
  const newp = String(body.new_password||'');
  if(!email || newp.length<8) return res.status(400).json({ ok:false, error:'Invalid request' });
  const { data, error } = await supabase.from('h2s_users').select('password_hash').eq('email', email).single();
  if(error || !data) return res.status(400).json({ ok:false, error:'Account not found' });
  if(!verifyPassword(oldp, data.password_hash)) return res.status(401).json({ ok:false, error:'Incorrect current password' });
  const pwHash = hashPassword(newp);
  const { error: updErr } = await supabase.from('h2s_users').update({ password_hash: pwHash }).eq('email', email);
  if(updErr) return res.status(400).json({ ok:false, error: updErr.message });
  return res.status(200).json({ ok:true });
}

async function handleUpsertUser(req, res, supabase, body){
  const u = body.user || {};
  const email = String(u.email||'').trim().toLowerCase();
  if(!email) return res.status(400).json({ ok:false, error:'Missing email' });
  const { data, error } = await supabase.from('h2s_users')
    .upsert({ email, full_name: u.name||'', phone: u.phone||'' }, { onConflict: 'email' })
    .select('email, full_name, phone').single();
  if(error) return res.status(400).json({ ok:false, error: error.message });
  return res.status(200).json({ ok:true, user:{ email:data.email, name:data.full_name||'', phone:data.phone||'' } });
}

async function handleGetUser(req, res, supabase, email){
  email = String(email||'').trim().toLowerCase();
  if(!email) return res.status(400).json({ ok:false, error:'Missing email' });
  const { data, error } = await supabase.from('h2s_users').select('email, full_name, phone, referral_code, points_balance, total_spent, stripe_customer_id, last_login').eq('email', email).single();
  if(error || !data) return res.status(200).json({ ok:true, user:null });
  // Map to frontend expectations
  return res.status(200).json({ ok:true, user: {
    email: data.email,
    name: data.full_name||'',
    phone: data.phone||'',
    referral_code: data.referral_code||'',
    credits: Number(data.points_balance||0),
    total_spent: Number(data.total_spent||0)
  }});
}

async function handleGetOrders(req, res, supabase, email){
  email = String(email||'').trim().toLowerCase();
  if(!email) return res.status(400).json({ ok:false, error:'Missing email' });
  const { data, error } = await supabase
    .from('h2s_orders')
    .select('order_id, created_at, order_total:total, order_summary:items, service_date:delivery_date, stripe_session_id:payment_intent_id')
    .eq('customer_email', email)
    .order('created_at', { ascending:false });
  if(error) return res.status(400).json({ ok:false, error: error.message });
  return res.status(200).json({ ok:true, orders: data||[] });
}

// Validate promotion code against specific line_items and estimate savings
async function handlePromoCheckCart(req, res, stripe, body){
  try{
    const code = String(body.promotion_code||'').trim();
    const items = Array.isArray(body.line_items) ? body.line_items : [];
    if(!code || !items.length) return res.status(400).json({ ok:false, error:'Missing code or items' });

    // Secret test promo fully discounts the cart (no Stripe mutation)
    const TEST_PROMO = process.env.SHOP_TEST_PROMO_CODE || '';
      if(TEST_PROMO && code === TEST_PROMO.trim()){
      // Retrieve prices to compute subtotal accurately
      const prices = await Promise.all(items.map(li => stripe.prices.retrieve(li.price)));
      let subtotal = 0;
      items.forEach((li, idx) => {
        const unit = Number(prices[idx]?.unit_amount||0);
        const qty  = Number(li.quantity||1)||1;
        subtotal += unit * qty;
      });
      return res.status(200).json({
        ok: true,
        applicable: true,
        promotion_code: code,
        estimate: {
          subtotal_cents: subtotal,
          qualifying_cents: subtotal,
          savings_cents: subtotal,
          total_cents: 0,
          summary: 'Test promo (100% off)',
          currency: (prices[0]?.currency)||'usd'
        },
        simulated: true
      });
    }

    const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
    const promo = list.data?.[0];
    if(!promo) return res.status(200).json({ ok:true, applicable:false, reason:'not_found' });
    const c = promo.coupon;
    if(c.valid === false) return res.status(200).json({ ok:true, applicable:false, reason:'inactive' });
    if(c.redeem_by && (Date.now() > c.redeem_by*1000)) return res.status(200).json({ ok:true, applicable:false, reason:'expired' });

    // Fetch price details and products for each line item
    const priceIds = items.map(li=> li.price).filter(Boolean);
    if(!priceIds.length) return res.status(400).json({ ok:false, error:'Missing price ids' });

    const prices = await Promise.all(priceIds.map(id => stripe.prices.retrieve(id, { expand: ['product'] })));
    const byId = new Map(prices.map(p=> [p.id, p]));

    let subtotal = 0;
    let qualifyingSubtotal = 0;
    const appliesProducts = c.applies_to?.products || null; // array of product IDs (if present)

    for(const li of items){
      const pr = byId.get(li.price);
      if(!pr || typeof pr.unit_amount !== 'number') continue;
      const qty = Number(li.quantity||1) || 1;
      const line = pr.unit_amount * qty;
      subtotal += line;
      const productId = pr.product && typeof pr.product === 'object' ? pr.product.id : pr.product;
      if(!appliesProducts || (Array.isArray(appliesProducts) && appliesProducts.includes(productId))){
        qualifyingSubtotal += line;
      }
    }

    // Minimum amount restriction
    const minAmt = promo.restrictions?.minimum_amount || 0;
    const minCur = promo.restrictions?.minimum_amount_currency || null;
    if(minAmt && qualifyingSubtotal < minAmt){
      return res.status(200).json({ ok:true, applicable:false, reason:'minimum_amount', minimum_cents:minAmt, currency:minCur||'usd' });
    }

    let savings = 0;
    if(c.percent_off){
      savings = Math.floor((qualifyingSubtotal * (c.percent_off/100)));
    } else if(c.amount_off){
      savings = c.amount_off; // cents
    }

    if(savings <= 0){
      return res.status(200).json({ ok:true, applicable:false, reason:'no_savings' });
    }

    const total = Math.max(0, subtotal - savings);
    const summary = c.percent_off ? `${c.percent_off}% off` : (c.amount_off ? `${(c.amount_off/100).toFixed(2)} ${c.currency||'usd'} off` : 'Discount');

    return res.status(200).json({
      ok: true,
      applicable: true,
      promotion_code: promo.code,
      estimate: {
        subtotal_cents: subtotal,
        qualifying_cents: qualifyingSubtotal,
        savings_cents: savings,
        total_cents: total,
        summary,
        currency: (prices[0]?.currency)||'usd'
      }
    });
  }catch(err){
    console.error('[PromoCheckCart] Error:', err);
    return res.status(200).json({ ok:true, applicable:false, reason:'error', message: err.message||'error' });
  }
}

function generateOrderId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 7);
  return `order_${timestamp}_${random}`;
}

async function handleOrderPack(req, res, supabase, sessionId) {
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'Missing session_id' });
  }

  try {
    // Fetch order by stripe_session_id
    const { data: order, error } = await supabase
      .from('h2s_orders')
      .select('*')
      .eq('stripe_session_id', sessionId)
      .single();

    if (error || !order) {
      console.error('[OrderPack] Order not found for session:', sessionId, error?.message);
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    console.log('[OrderPack] ✅ Found order:', order.order_id);

    // Parse cart items from 'items' JSON column
    let cartItems = [];
    try {
      cartItems = JSON.parse(order.items || '[]');
    } catch (e) {
      console.error('[OrderPack] Failed to parse items JSON:', e);
    }

    // Build response matching what success page expects
    const response = {
      ok: true,
      summary: {
        order_id: order.order_id,
        session_id: order.session_id,
        total: Number(order.total || 0),
        subtotal: Number(order.subtotal || 0),
        tax: Number(order.tax || 0),
        currency: order.currency || 'usd',
        created_at: order.created_at,
        discount_code: order.stripe_coupon_id || '',
        discount_amount: order.discount_amount || '0'
      },
      lines: cartItems.map((item, idx) => ({
        line_index: idx,
        line_type: item.type || 'service',
        service_id: item.service_id || null,
        bundle_id: item.bundle_id || null,
        service_name: item.service_name || null,
        option_id: item.option_id || null,
        qty: item.qty || 1,
        unit_price: item.unit_price || 0,
        line_total: item.line_total || 0
      }))
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[OrderPack] Error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
