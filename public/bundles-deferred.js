
// === DEFERRED HEAVY LOGIC ===
// Loaded only when needed (Account, Checkout, Auth)

// === UTILITY FUNCTIONS FOR DEFERRED BUNDLE ===
function escapeAttr(text) {
  if(!text) return '';
  return String(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showMsg(elId, txt, isError = true) {
  const el = document.getElementById(elId);
  if(el) {
    el.textContent = txt;
    el.style.color = isError ? '#d32f2f' : '#2e7d32';
  }
}

window.checkout = async function(){
  const btn = document.getElementById('checkoutBtn');
  const msg = document.getElementById('cartMsg');
  
  if(cart.length === 0){
    if(msg) msg.textContent = 'Cart is empty';
    return;
  }
  
  // CRITICAL: Require customer contact info before checkout
  if (!user || !user.email) {
    const proceed = confirm('You need to sign in or provide contact information to checkout. Would you like to sign in now?');
    if (proceed) {
      navSet({view: 'signin'});
    }
    return;
  }

  // Ensure we have minimum contact info (name, email, phone)
  if (!user.name || !user.phone) {
    const name = user.name || prompt('Please enter your full name:');
    const phone = user.phone || prompt('Please enter your phone number (for appointment scheduling):');
    
    if (!name || !phone) {
      alert('Name and phone number are required for scheduling your installation.');
      return;
    }
    
    // Update user profile with missing info
    user.name = name;
    user.phone = phone;
    saveUser();
    
    // Also save to backend
    try {
      await fetch(API, {
        method: 'POST',
        body: JSON.stringify({
          __action: 'upsert_user',
          user: {
            email: user.email,
            name: user.name,
            phone: user.phone
          }
        })
      });
    } catch(err) {
      console.warn('Failed to update user profile:', err);
    }
  }
  
  // Validate cart items against catalog
  const invalidItems = cart.filter(item => {
    if(item.type !== 'package') return false; // Skip services for now
    const bundle = catalog.bundles.find(b => b.bundle_id === item.id);
    return !bundle || !bundle.stripe_price_id;
  });
  
  if(invalidItems.length > 0){
    console.error('Invalid items in cart:', invalidItems);
    if(msg) {
      msg.textContent = 'Some items are no longer available. Please clear cart and try again.';
      msg.style.color = '#d32f2f';
    }
    return;
  }

  if(btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Processing...';
  }
  
  showLoader();
  
  try{
    // Prepare line items for Stripe
    const line_items = cart.map(item => {
      if(item.type === 'package'){
        const bundle = catalog.bundles.find(b => b.bundle_id === item.id);
        if(!bundle || !bundle.stripe_price_id) {
          console.warn('Package missing stripe_price_id:', item.id);
          return null;
        }
        return {
          price: bundle.stripe_price_id,
          quantity: item.qty || 1
        };
      } else {
        // Handle services/addons if they have price IDs
        // For now, we might need a fallback or dynamic price
        return null; 
      }
    }).filter(Boolean);

    if(line_items.length === 0){
      throw new Error('No valid items to checkout');
    }

    // Get promo code if any
    const promoCode = localStorage.getItem('h2s_promo_code');

    // Build metadata from cart items
    const cartMetadata = {
      session_id: SESSION_ID,
      source: 'shop_v2',
      customer_name: user?.name || '',
      customer_phone: user?.phone || '',
      customer_email: user?.email || '',
      cart_items: JSON.stringify(cart.map(item => ({
        id: item.id,
        name: item.name,
        qty: item.qty,
        price: item.price,
        type: item.type,
        metadata: item.metadata || {}
      })))
    };

    // Create Checkout Session
    const payload = {
      __action: 'create_checkout_session',
      line_items,
      success_url: 'https://home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: window.location.href,
      customer_email: user?.email,
      client_reference_id: user?.id || SESSION_ID,
      metadata: cartMetadata
    };
    
    if(promoCode){
      payload.promotion_code = promoCode;
    }

    // Create checkout snapshot for fallback on success page
    const snapshot = {
      cart: cart.map(item => ({
        type: item.type,
        id: item.id,
        name: item.name,
        price: item.price,
        qty: item.qty,
        metadata: item.metadata || {}
      })),
      subtotal: cartSubtotal(),
      currency: 'USD',
      promo_code: promoCode || '',
      timestamp: new Date().toISOString()
    };
    localStorage.setItem('h2s_checkout_snapshot', JSON.stringify(snapshot));
    console.log('✓ Created checkout snapshot:', snapshot);

    console.log('Initiating checkout with:', payload);

    const res = await fetch(API, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    
    if(!data.ok){
      console.error('❌ Backend error:', data.error || 'Unknown');
      console.error('Full error data:', data);
      showCheckoutError(data.error || 'Checkout failed. Please contact support.');
      return;
    }
    
    const url = data?.pay?.session_url;
    if(!url){
      console.error('❌ No checkout URL in response');
      showCheckoutError('Could not create checkout session. Missing Stripe URL.');
      return;
    }
    
    console.log('\n✅ CHECKOUT SESSION CREATED SUCCESSFULLY!');
    console.log('Session URL:', url);
    
    // Track checkout before redirect
    h2sTrack('BeginCheckout', {
      cart_total: cartSubtotal(),
      session_url: url
    });
    
    // Redirect immediately
    window.location.href = url;
    
  }catch(err){
    console.error('❌ Network error during checkout:', err);
    showCheckoutError('Network error: ' + err.message);
    hideLoader();
  } finally {
    // Ensure button is re-enabled if we didn't redirect
    if(btn && !btn.disabled) {
      // Button was already re-enabled by showCheckoutError
    } else if(btn) {
      setTimeout(() => {
        if(window.location.href.indexOf('stripe') === -1) {
          // Still on our page, not redirected - re-enable
          btn.disabled = false;
          btn.textContent = 'Checkout';
        }
      }, 1000);
    }
  }
};

function showCheckoutError(msg){
  const el = document.getElementById('cartMsg');
  const btn = document.getElementById('checkoutBtn');
  if(el) {
    el.textContent = msg;
    el.style.color = '#d32f2f';
  }
  if(btn) {
    btn.disabled = false;
    btn.textContent = 'Checkout';
  }
  alert(msg);
}

window.renderShopSuccess = async function(){
  const params = new URL(location.href).searchParams;
  const sessionId = params.get('session_id') || params.get('stripe_session_id') || '';

  let order = {
    order_id:           params.get('order_id') || '',
    stripe_session_id:  sessionId,
    order_created_at:   params.get('order_created_at') || new Date().toISOString(),
    order_source:       params.get('order_source') || '/shop',
    order_total:        params.get('order_total') || '',
    order_subtotal:     params.get('order_subtotal') || '',
    order_tax:          params.get('order_tax') || '',
    order_fees:         params.get('order_fees') || '',
    order_currency:     params.get('order_currency') || 'USD',
    order_discount_code:   params.get('order_discount_code') || '',
    order_discount_amount: params.get('order_discount_amount') || '',
    order_item_count:   params.get('order_item_count') || '',
    order_summary:      params.get('order_summary') || '',
    order_lines_json:   params.get('order_lines_json') || '',
    bundle_applied:     params.get('bundle_applied') || '',
    membership_plan:    params.get('membership_plan') || '',
    utm_source:   params.get('utm_source') || '',
    utm_medium:   params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || '',
    utm_term:     params.get('utm_term') || '',
    utm_content:  params.get('utm_content') || ''
  };

  // PRIORITY 1: Mark session as success_redirect in backend
  if(sessionId){
    try{
      await fetch(API, {
        method: 'POST',
        body: JSON.stringify({
          __action: 'mark_session',
          session_id: sessionId,
          status: 'success_redirect',
          note: 'User returned from Stripe at ' + new Date().toISOString()
        })
      });
      console.log('✓ Marked session as success_redirect:', sessionId);
    }catch(err){
      console.error('Failed to mark session:', err);
    }
  }

  // PRIORITY 2: Fetch authoritative order data from backend
  if(sessionId){
    try{
      const res = await fetch(`https://h2s-backend-lvl1lgbhs-tabari-ropers-projects-6f2e090b.vercel.app/api/get-order-details?session_id=${sessionId}`);
      const data = await res.json();
      if(data.ok && data.order){
        console.log('✓ Fetched order details from backend:', data.order.order_id);
        order.order_id = data.order.order_id || sessionId;
        order.order_total = data.order.amount_total || '';
        order.order_currency = data.order.currency || 'USD';
        order.order_item_count = String(data.order.item_count || 0);
        order.order_created_at = data.order.created_at || order.order_created_at;
        order.order_discount_code = data.order.discount_code || '';
        order.order_summary = data.order.order_summary || '';
        order.customer_name = data.order.customer_name || '';
        order.customer_email = data.order.customer_email || '';
        order.customer_phone = data.order.customer_phone || '';
        
        // Store detailed items for display
        order.items = data.order.items || [];
      }
    }catch(err){
      console.error('Failed to fetch order details:', err);
    }
  }

  // Fallback to snapshot if backend fetch failed
  if(!order.order_id || !order.order_summary){
    try{
      const snap = JSON.parse(localStorage.getItem('h2s_checkout_snapshot') || '{}');
      if(Array.isArray(snap.cart)){
        console.log('⚠ Using localStorage fallback for order data');
        if(!order.order_item_count) order.order_item_count = String(snap.cart.reduce((n,l)=> n + Number(l.qty||0), 0));
        if(!order.order_subtotal) order.order_subtotal = typeof snap.subtotal === 'number' ? String(snap.subtotal.toFixed(2)) : '';
        if(!order.order_currency) order.order_currency = snap.currency || 'USD';
        
        if(!order.order_summary){
          const parts = [];
          snap.cart.forEach(l=>{
            if(l.type==='package'){
              parts.push(`${Number(l.qty||1)}× ${l.name||'Package'}`);
            }else{
              parts.push(`${Number(l.qty||0)}× ${l.service_id||'Service'}`);
            }
          });
          order.order_summary = parts.join(' | ');
        }
        
        if(!order.order_lines_json) order.order_lines_json = encodeURIComponent(JSON.stringify(snap.cart||[]));
        if(!order.order_created_at) order.order_created_at = snap.created_at || new Date().toISOString();
        if(!order.order_source) order.order_source = snap.source || '/shop';
        
        if(!order.order_id){
          order.order_id = sessionId || '';
        }
      }
    }catch(err){
      console.error('Failed to parse localStorage snapshot:', err);
    }
  }

  // Prefill contact from local user or params
  const name = (user?.name||params.get('name')||'').trim();
  const [first_name, ...rest] = name.split(' ');
  const last_name = rest.join(' ');
  const email = (user?.email||params.get('email')||'').trim();
  const phone = (user?.phone||params.get('phone')||'').trim();

  // Hidden fields for calendar form
  const q = new URLSearchParams();
  if(first_name) q.set('first_name', first_name);
  if(last_name) q.set('last_name', last_name);
  if(email) q.set('email', email);
  if(phone) q.set('phone', phone);

  const stableOrderId = order.order_id || order.stripe_session_id || '';
  if(stableOrderId) q.set('order_id', stableOrderId);

  [
    'stripe_session_id','order_created_at','order_source',
    'order_total','order_subtotal','order_tax','order_fees','order_currency',
    'order_discount_code','order_discount_amount',
    'order_item_count','order_summary','order_lines_json',
    'bundle_applied','membership_plan',
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content'
  ].forEach(k=>{
    if(order[k]!==undefined && order[k]!==null && String(order[k]).length){
      q.set(k, String(order[k]));
    }
  });

  q.set('redirect_url', 'https://home2smart.com/shop?view=apptreturn');

  const calSrc = CAL_FORM_URL + (CAL_FORM_URL.includes('?') ? '&' : '?') + q.toString();

  const prettyTotal = order.order_total != null && order.order_total !== '' 
    ? money(Number(order.order_total)) 
    : (order.order_subtotal != null && order.order_subtotal !== '' 
      ? money(Number(order.order_subtotal)) 
      : '$0.00');
  const displayOrderId = order.order_id || order.stripe_session_id || 'N/A';
  const shortOrderId = displayOrderId.length > 20 ? displayOrderId.substring(0, 20) + '...' : displayOrderId;

  cart = [];
  saveCart();
  localStorage.removeItem('h2s_checkout_snapshot');
  localStorage.removeItem('h2s_promo_code');
  
  // Ensure cart badge is updated
  if(typeof updateCartBadge === 'function') {
    updateCartBadge();
  }
  
  // Ensure cart drawer reflects empty state if it's open
  if(typeof paintCart === 'function') {
    paintCart();
  }

  h2sTrack('Purchase', {
    order_id: displayOrderId,
    value: order.order_total || order.order_subtotal || '0',
    currency: order.order_currency || 'USD',
    num_items: order.order_item_count || '0'
  });

  byId('outlet').innerHTML = `
    <section class="form" style="max-width: 720px; margin: 60px auto 40px;">
      <!-- Success Header -->
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <h2 style="margin: 0 0 8px 0; font-weight: 900; font-size: 28px; color: var(--cobalt);">Order Confirmed!</h2>
        <p style="margin: 0; color: var(--muted); font-size: 15px;">Thank you for choosing Home2Smart</p>
      </div>

      <!-- Order Details Card -->
      <div style="background: #f8f9fb; border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 800; color: var(--cobalt); text-transform: uppercase; letter-spacing: 0.5px;">Order Details</h3>
        
        <div class="details-grid" style="display: grid; gap: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
            <span style="font-weight: 600; color: var(--muted); font-size: 14px;">Order ID</span>
            <span style="font-family: monospace; font-size: 13px; color: var(--cobalt); font-weight: 700; word-break: break-all; max-width: 60%; text-align: right;" title="${escapeHtml(displayOrderId)}">${escapeHtml(shortOrderId)}</span>
          </div>
          
          ${order.items && order.items.length > 0 ? `
          <div style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
            <div style="font-weight: 600; color: var(--muted); font-size: 14px; margin-bottom: 8px;">Items Purchased</div>
            ${order.items.map(item => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; padding-left: 12px;">
                <span style="color: var(--ink); font-size: 14px;">
                  <span style="font-weight: 700; color: var(--azure);">${item.qty}×</span> ${escapeHtml(item.name || item.id || 'Item')}
                </span>
                ${item.price ? `<span style="font-size: 13px; color: var(--muted); font-weight: 600;">$${(item.price / 100).toFixed(2)}</span>` : ''}
              </div>
            `).join('')}
          </div>
          ` : `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
            <span style="font-weight: 600; color: var(--muted); font-size: 14px;">Items</span>
            <span style="font-weight: 700; color: var(--ink); font-size: 14px;">${escapeHtml(order.order_summary || (order.order_item_count ? `${order.order_item_count} item${order.order_item_count === '1' ? '' : 's'}` : '—'))}</span>
          </div>
          `}
          
          ${order.order_discount_code ? `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
            <span style="font-weight: 600; color: var(--muted); font-size: 14px;">Promo Applied</span>
            <span style="font-weight: 700; color: #059669; font-size: 14px; font-family: monospace;">${escapeHtml(order.order_discount_code)}</span>
          </div>
          ` : ''}
          
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 0 0 0;">
            <span style="font-weight: 800; color: var(--ink); font-size: 16px;">Total Paid</span>
            <span style="font-weight: 900; color: var(--cobalt); font-size: 22px;">${escapeHtml(prettyTotal)} <span style="font-size: 14px; font-weight: 600; color: var(--muted);">${escapeHtml(order.order_currency?.toUpperCase() || 'USD')}</span></span>
          </div>
        </div>
      </div>

      <!-- Next Step -->
      <div style="background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border: 2px solid #93c5fd; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <div style="width: 32px; height: 32px; background: var(--cobalt); border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          </div>
          <h3 style="margin: 0; font-size: 17px; font-weight: 800; color: var(--cobalt);">📅 Schedule Your Installation</h3>
        </div>
        <p style="margin: 0; color: #1e3a8a; font-size: 14px; line-height: 1.6;">Pick a convenient date and time below. We'll send you a confirmation email with all the details.</p>
      </div>

      <!-- Custom Calendar Widget -->
      <div id="calendar-widget" style="border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px; background: white; box-shadow: 0 4px 16px rgba(0,0,0,0.08);">
        <div id="calendar-loading" style="text-align: center; padding: 40px 20px;">
          <div style="border: 4px solid #f3f4f6; border-top: 4px solid var(--azure); border-radius: 50%; width: 50px; height: 50px; animation: spin 1s linear infinite; margin: 0 auto 20px;"></div>
          <p style="color: var(--muted); margin: 0;">Loading available appointments...</p>
        </div>
        
        <div id="calendar-view" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
            <h3 id="calendar-month-year" style="margin: 0; font-size: 18px; font-weight: 700; color: var(--slate);"></h3>
            <div style="display: flex; gap: 12px;">
              <button id="calendar-prev-month" style="background: white; border: 2px solid var(--border); width: 40px; height: 40px; border-radius: 8px; cursor: pointer; font-size: 18px; transition: all 0.2s;">‹</button>
              <button id="calendar-next-month" style="background: white; border: 2px solid var(--border); width: 40px; height: 40px; border-radius: 8px; cursor: pointer; font-size: 18px; transition: all 0.2s;">›</button>
            </div>
          </div>
          
          <div id="calendar-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; margin-bottom: 30px;"></div>
          
          <div id="calendar-time-slots-container" style="display: none; margin-top: 30px; padding-top: 30px; border-top: 2px solid var(--border);">
            <h3 id="calendar-selected-date-label" style="font-size: 16px; font-weight: 700; margin-bottom: 16px; color: var(--slate);"></h3>
            <div id="calendar-time-slots" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;"></div>
          </div>
          
          <div id="calendar-confirm-section" style="display: none; margin-top: 30px; padding: 24px; background: #f8f9fb; border-radius: 12px; text-align: center;">
            <h3 style="font-size: 17px; font-weight: 700; margin-bottom: 12px; color: var(--slate);">Confirm Your Appointment</h3>
            <div id="calendar-selected-time-display" style="font-size: 19px; font-weight: 700; color: var(--azure); margin-bottom: 20px;"></div>
            <button id="calendar-confirm-btn" class="btn btn-primary" style="padding: 16px 32px; font-size: 16px; font-weight: 700;">Confirm Appointment</button>
          </div>
          
          <div id="calendar-error" style="display: none; background: #fef2f2; border: 2px solid #ef4444; border-radius: 8px; padding: 16px; margin: 20px 0; color: #dc2626; text-align: center;"></div>
        </div>
        
        <div id="calendar-success" style="display: none; text-align: center; padding: 40px 20px;">
          <div style="width: 64px; height: 64px; border-radius: 50%; background: #10b981; color: white; font-size: 40px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; animation: scaleIn 0.5s ease;">✓</div>
          <h2 style="font-size: 24px; font-weight: 900; color: var(--slate); margin-bottom: 12px;">Appointment Confirmed!</h2>
          <p style="color: var(--muted); line-height: 1.6; margin: 0;">We've sent you a confirmation via email and text message. You'll receive a reminder 24 hours before your appointment.</p>
        </div>
      </div>

      <!-- Footer Actions -->
      <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center;">
        <button class="btn btn-ghost" id="backToShop" style="min-width: 160px;">← Back to Shop</button>
        <a href="tel:864-528-1475" class="btn btn-secondary" style="min-width: 160px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center;">📞 Call Support</a>
      </div>
    </section>
  `;

  byId('backToShop').onclick = ()=> navSet({view:null});
  
  // Initialize custom calendar (use requestAnimationFrame for faster rendering)
  requestAnimationFrame(() => {
    initializeCustomCalendar(stableOrderId);
  });
};

window.handleCalReturn = async function(){
  const order_id = getParam('order_id') || '';
  const startIso = getParam('start') || '';

  byId('outlet').innerHTML = `
    <section class="form">
      <h2 style="margin:0 0 10px 0;font-weight:900">Saving your appointment…</h2>
      <div class="help">Just a moment.</div>
    </section>
  `;

  try{
    if(!user || !user.email) throw new Error('You must be signed in.');
    if(!startIso) throw new Error('Missing appointment time.');
    
    const res = await fetch(APIV1, {
      method:'POST',
      body: JSON.stringify({
        __action: 'record_install_slot',
        email: user.email,
        order_id: order_id || '',
        install_at: startIso || '',
        install_end_at: getParam('end') || '',
        timezone: getParam('tz') || ''
      })
    });
    
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'Failed to save appointment');
    
    console.log('✅ Appointment saved, job creation triggered');
  }catch(err){
    console.error('❌ Appointment save failed:', err);
    alert(err.message);
  }

  navSet({view:'account'});
};

window.renderSignIn = function(){
  const outlet = byId('outlet');
  outlet.innerHTML = `
    <section class="form">
      <div style="text-align:center; margin-bottom:24px;">
        <a href="#" onclick="navSet({view:'shop'}); return false;" class="link-btn" style="font-size:14px; color:var(--azure); font-weight:600;">
          ← Back to shop
        </a>
      </div>
      <h2>Sign in to your account</h2>
      <p class="help" style="text-align:center; color:var(--text-muted); margin-bottom:20px;">Access your dashboard, track orders, and manage your account.</p>
      <input class="inp" id="siEmail" type="email" placeholder="Email address" value="${escapeAttr(user?.email||'')}" autocomplete="email">
      <input class="inp" id="siPass"  type="password" placeholder="Password" autocomplete="current-password">
      <div style="display:flex; gap:12px; margin-top:24px; flex-direction:column;">
        <button class="btn btn-primary" id="signin" style="width:100%;">Sign in</button>
        <button class="btn btn-ghost" id="toSignup" style="width:100%;">Create account</button>
        <button class="btn btn-subtle" id="toForgot" style="padding:10px; margin-top:8px;">Forgot password?</button>
      </div>
      <div id="siMsg" class="help" style="margin-top:16px; color:#d32f2f;"></div>
    </section>
  `;
  
  outlet.style.opacity = '1';
  outlet.style.transition = '';
  document.body.classList.add('app-ready');
  
  byId('toSignup').onclick = ()=> navSet({view:'signup'});
  byId('toForgot').onclick = ()=> navSet({view:'forgot'});
  byId('signin').onclick = async ()=>{
    const email = byId('siEmail').value.trim();
    const pass  = byId('siPass').value;
    if(!email){ return showMsg('siMsg','Enter your email.'); }
    if(!pass){ return showMsg('siMsg','Enter your password.'); }
    showLoader();
    try{
      const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'signin', email, password:pass })});
      const text = await resp.text();
      if(!resp.ok){ showMsg('siMsg', text || ('Error ' + resp.status)); return; }
      const data = JSON.parse(text);
      if(!data.ok){ showMsg('siMsg', data.error||'Sign in failed'); return; }
      user = { name:data.user.name||'', email:data.user.email, phone:data.user.phone||'' };
      saveUser();
      loadAIRecommendations();
      h2sTrack('Login', { user_email: user.email });
      navSet({view:'account'});
    }catch(err){ showMsg('siMsg', String(err)); }
    finally{ hideLoader(); }
  };
};

window.renderSignUp = function(){
  const seed = user||{};
  const outlet = byId('outlet');
  outlet.innerHTML = `
    <section class="form">
      <div style="text-align:center; margin-bottom:24px;">
        <a href="#" onclick="navSet({view:'shop'}); return false;" class="link-btn" style="font-size:14px; color:var(--azure); font-weight:600;">
          ← Back to shop
        </a>
      </div>
      <h2>Create your account</h2>
      <p class="help" style="text-align:center; color:var(--text-muted); margin-bottom:20px;">Get exclusive discounts, earn credits, and track your installations.</p>
      <input class="inp" id="suName"  type="text"  placeholder="Full name" value="${escapeAttr(seed.name||'')}" autocomplete="name">
      <input class="inp" id="suEmail" type="email" placeholder="Email address" value="${escapeAttr(seed.email||'')}" autocomplete="email">
      <input class="inp" id="suPhone" type="tel"   placeholder="Phone number" value="${escapeAttr(seed.phone||'')}" autocomplete="tel">
      <input class="inp" id="suPass"  type="password" placeholder="Password (min 8 characters)" autocomplete="new-password">
      <input class="inp" id="suPass2" type="password" placeholder="Confirm password" autocomplete="new-password">
      <div class="help" style="text-align:center; color:var(--text-muted); margin-top:8px;">Secure checkout, order tracking, and rewards</div>
      <div style="display:flex; gap:12px; margin-top:24px; flex-direction:column;">
        <button class="btn btn-primary" id="createAcct" style="width:100%;">Create account</button>
        <button class="btn btn-ghost" id="toSignin" style="width:100%;">Already have an account? Sign in</button>
      </div>
      <div id="suMsg" class="help" style="margin-top:16px;"></div>
    </section>
  `;
  
  outlet.style.opacity = '1';
  outlet.style.transition = '';
  document.body.classList.add('app-ready');
  
  byId('toSignin').onclick = ()=> navSet({view:'signin'});
  byId('createAcct').onclick = async ()=>{
    const name  = byId('suName').value.trim();
    const email = byId('suEmail').value.trim();
    const phone = byId('suPhone').value.trim();
    const pw1   = byId('suPass').value;
    const pw2   = byId('suPass2').value;
    const msg   = byId('suMsg');
    const btn   = byId('createAcct');
    
    if(!email){ return showMsg('suMsg','Enter your email.'); }
    if(pw1.length < 8){ return showMsg('suMsg','Password must be at least 8 characters.'); }
    if(pw1 !== pw2){ return showMsg('suMsg','Passwords do not match.'); }
    showLoader();
    try{
      const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'create_user', user:{name,email,phone,password:pw1}})});
      const text = await resp.text();
      if(!resp.ok){ showMsg('suMsg', text || ('Error ' + resp.status)); return; }
      const data = JSON.parse(text);
      if(!data.ok){ showMsg('suMsg', data.error||'Create failed'); return; }
      user = {name:data.user.name||'', email:data.user.email, phone:data.user.phone||''};
      saveUser();
      loadAIRecommendations();
      h2sTrack('CompleteRegistration', { user_email: user.email, user_name: user.name });
      
      if(msg && btn){
        msg.style.color = '#2e7d32';
        msg.textContent = '✓ Account created! Welcome to Home2Smart.';
        btn.textContent = 'Success!';
        btn.disabled = true;
      }
      
      setTimeout(() => {
        navSet({view:'account'});
      }, 1200);
    }catch(err){ showMsg('suMsg', String(err)); }
    finally{ hideLoader(); }
  };
};

window.renderForgot = function(){
  const outlet = byId('outlet');
  outlet.innerHTML = `
    <section class="form">
      <div style="text-align:center; margin-bottom:24px;">
        <a href="#" onclick="navSet({view:'shop'}); return false;" class="link-btn" style="font-size:14px; color:var(--azure); font-weight:600;">
          ← Back to shop
        </a>
      </div>
      <h2>Forgot password</h2>
      <p class="help" style="text-align:center; color:var(--text-muted); margin-bottom:20px;">Enter your email and we'll send you a reset link.</p>
      <input class="inp" id="fpEmail" type="email" placeholder="Email address" autocomplete="email">
      <div style="display:flex; gap:12px; margin-top:24px; flex-direction:column;">
        <button class="btn btn-primary" id="fpSend" style="width:100%;">Send reset link</button>
        <button class="btn btn-ghost" id="fpBack" style="width:100%;">Back to sign in</button>
      </div>
      <div id="fpMsg" class="help" style="margin-top:16px; color:#d32f2f;"></div>
    </section>
  `;
  
  outlet.style.opacity = '1';
  outlet.style.transition = '';
  document.body.classList.add('app-ready');
  
  byId('fpBack').onclick = ()=> navSet({view:'signin'});
  byId('fpSend').onclick = async ()=>{
    const email = byId('fpEmail').value.trim();
    if(!email){ return showMsg('fpMsg','Enter your email.'); }
    showLoader();
    try{
      const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'request_password_reset', email})});
      const txt  = await resp.text();
      if(!resp.ok){ showMsg('fpMsg', txt || ('Error ' + resp.status)); return; }
      showMsg('fpMsg','If that email has an account, a reset link has been sent. Check your inbox.');
    }catch(err){ showMsg('fpMsg', String(err)); }
    finally{ hideLoader(); }
  };
};

window.renderReset = function(token){
  const outlet = byId('outlet');
  outlet.innerHTML = `
    <section class="form">
      <h2 style="margin:0 0 10px 0;font-weight:900">Reset password</h2>
      <input class="inp" id="rpToken" type="text" placeholder="Reset token" value="${escapeAttr(token||'')}">
      <input class="inp" id="rpNew1" type="password" placeholder="New password (min 8)">
      <input class="inp" id="rpNew2" type="password" placeholder="Confirm new password">
      <div style="display:flex; gap:10px; margin-top:6px; flex-wrap:wrap">
        <button class="btn azure" id="rpDo">Set new password</button>
        <button class="btn ghost" id="rpBack">Back to sign in</button>
      </div>
      <div id="rpMsg" class="help"></div>
    </section>
  `;
  
  outlet.style.opacity = '1';
  outlet.style.transition = '';
  document.body.classList.add('app-ready');
  
  byId('rpBack').onclick = ()=> navSet({view:'signin'});
  byId('rpDo').onclick = async ()=>{
    const tok = byId('rpToken').value.trim();
    const p1   = byId('rpNew1').value;
    const p2   = byId('rpNew2').value;
    if(!tok){ return showMsg('rpMsg','Missing reset token.'); }
    if(p1.length<8){ return showMsg('rpMsg','Password must be at least 8 characters.'); }
    if(p1!==p2){ return showMsg('rpMsg','Passwords do not match.'); }
    showLoader();
    try{
      const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'reset_password', token:tok, new_password:p1})});
      const txt  = await resp.text();
      if(!resp.ok){ showMsg('rpMsg', txt || ('Error ' + resp.status)); return; }
      const data = JSON.parse(txt);
      if(!data.ok){ showMsg('rpMsg', data.error||'Could not reset password'); return; }
      showMsg('rpMsg','Password updated. You can now sign in.');
      setTimeout(()=> navSet({view:'signin'}), 800);
    }catch(err){ showMsg('rpMsg', String(err)); }
    finally{ hideLoader(); }
  };
};

window.renderAccount = function(){
  if(!user || !user.email){ navSet({view:'signin'}); return; }

  if(!user.referral_code && !window._userRefreshing){
    window._userRefreshing = true;
    fetch(API + '?action=user&email=' + encodeURIComponent(user.email))
      .then(r=>r.json())
      .then(d=>{
        window._userRefreshing = false;
        if(d.ok && d.user){
          user = { ...user, ...d.user };
          saveUser();
          renderAccount();
        }
      }).catch(()=> window._userRefreshing = false);
  }

  const outlet = byId('outlet');
  outlet.innerHTML = `
    <section class="form">
      <div style="text-align:center; margin-bottom:24px;">
        <a href="#" onclick="navSet({view:null}); return false;" class="link-btn" style="font-size:14px; color:var(--azure); font-weight:600;">
          ← Back to shop
        </a>
      </div>
      <h2 style="margin:0 0 10px 0;font-weight:900">Your account</h2>
      <p class="help" style="text-align:center; color:var(--text-muted); margin-bottom:20px;">Manage your profile, view orders, and track your rewards.</p>
      <input class="inp" id="acName"  type="text"  placeholder="Full name" value="${escapeAttr(user.name||'')}">
      <input class="inp" id="acEmail" type="email" placeholder="Email" value="${escapeAttr(user.email||'')}" disabled>
      <input class="inp" id="acPhone" type="tel"   placeholder="Phone" value="${escapeAttr(user.phone||'')}">
      <div style="display:flex; gap:12px; margin-top:24px; flex-direction:column;">
        <button class="btn btn-primary" id="saveAcct" style="width:100%;">Save changes</button>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-ghost" id="signOut" style="flex:1;">Sign out</button>
        </div>
      </div>
      <div id="acMsg" class="help" style="margin-top:16px;"></div>
    </section>

    <section class="form" style="margin-top:24px">
      <h3 style="margin:0 0 10px 0;font-weight:900">Rewards & Credits</h3>
      <div class="pd-box" style="background:#f0f9ff; border-color:#bae6fd;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <div style="font-weight:800; color:#0284c7;">Available Credits</div>
          <div style="font-weight:900; font-size:18px; color:#0284c7;">${money(user.credits||0)}</div>
        </div>
        <div style="margin-top:12px; padding-top:12px; border-top:1px solid #bae6fd;">
          <div style="font-weight:800; color:#0284c7; margin-bottom:4px;">Your Referral Code</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <div style="font-family:monospace; font-weight:900; font-size:18px; letter-spacing:1px; background:#fff; padding:8px 12px; border-radius:6px; border:1px dashed #0284c7; color:#0284c7;">
              ${escapeHtml(user.referral_code || 'Loading...')}
            </div>
            <button class="btn btn-primary" style="padding:8px 16px; font-size:13px;" onclick="navigator.clipboard.writeText('${escapeHtml(user.referral_code||'')}').then(()=>this.textContent='Copied!')">Copy Code</button>
          </div>
          <div style="font-size:13px; color:#0369a1; margin-top:8px;">Share this code. Friends get discount, you get credit.</div>
        </div>
      </div>
    </section>

    <section class="form" style="margin-top:24px">
      <button class="btn ghost" id="cpToggle" aria-expanded="false">Change password</button>
      <div id="cpPanel" class="pd-box" style="display:none; margin-top:10px">
        <h3 style="margin:0 0 10px 0;font-weight:900">Change password</h3>
        <input class="inp" id="cpOld" type="password" placeholder="Current password">
        <input class="inp" id="cpNew1" type="password" placeholder="New password (min 8)">
        <input class="inp" id="cpNew2" type="password" placeholder="Confirm new password">
        <div style="display:flex; gap:10px; margin-top:6px; flex-wrap:wrap">
          <button class="btn azure" id="cpDo">Update password</button>
        </div>
        <div id="cpMsg" class="help"></div>
      </div>
    </section>

    <section class="form" style="margin-top:24px">
      <h3 style="margin:0 0 10px 0;font-weight:900">Previous orders</h3>
      <div id="ordersBox" class="pd-box"><div class="help">Loading…</div></div>
    </section>
  `;

  byId('saveAcct').onclick = async ()=>{
    const name  = byId('acName').value.trim();
    const phone = byId('acPhone').value.trim();
    showLoader();
    try{
      const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'upsert_user', user:{name,phone,email:user.email}})});
      const text = await resp.text();
      if(!resp.ok){ showMsg('acMsg', text || ('Error ' + resp.status)); return; }
      const data = JSON.parse(text);
      if(!data.ok){ showMsg('acMsg', data.error||'Save failed'); return; }
      user = { ...user, name:data.user.name||'', phone:data.user.phone||'' };
      saveUser();
      showMsg('acMsg','✓ Saved successfully.');
    }catch(err){ showMsg('acMsg', String(err)); }
    finally{ hideLoader(); }
  };
  byId('signOut').onclick = ()=>{ user = {}; saveUser(); navSet({view:null}); };

  outlet.style.opacity = '1';
  outlet.style.transition = '';
  document.body.classList.add('app-ready');

  const cpToggle = byId('cpToggle');
  const cpPanel  = byId('cpPanel');
  if(cpToggle && cpPanel){
    cpToggle.onclick = ()=>{
      const open = cpPanel.style.display !== 'none';
      cpPanel.style.display = open ? 'none' : '';
      cpToggle.setAttribute('aria-expanded', String(!open));
    };
  }

  const cpDo = byId('cpDo');
  if(cpDo){
    cpDo.onclick = async ()=>{
      const oldp = byId('cpOld').value;
      const p1   = byId('cpNew1').value;
      const p2   = byId('cpNew2').value;
      if(!oldp){ return showMsg('cpMsg','Enter your current password.'); }
      if(p1.length<8){ return showMsg('cpMsg','New password must be at least 8 characters.'); }
      if(p1!==p2){ return showMsg('cpMsg','Passwords do not match.'); }
      showLoader();
      try{
        const resp = await fetch(API, { method:'POST', body: JSON.stringify({__action:'change_password', email:user.email, old_password:oldp, new_password:p1})});
        const txt  = await resp.text();
        if(!resp.ok){ showMsg('cpMsg', txt || ('Error ' + resp.status)); return; }
        const data = JSON.parse(txt);
        if(!data.ok){ showMsg('cpMsg', data.error||'Could not change password'); return; }
        showMsg('cpMsg','Password updated.');
        byId('cpOld').value = byId('cpNew1').value = byId('cpNew2').value = '';
      }catch(err){ showMsg('cpMsg', String(err)); }
      finally{ hideLoader(); }
    };
  }

  loadOrders();
};

async function loadOrders(){
  const box = byId('ordersBox');
  if(!box) return;
  try{
    const res = await fetch(API + '?action=orders&email=' + encodeURIComponent(user.email));
    const data = await res.json();
    const orders = Array.isArray(data.orders) ? data.orders : [];
    if(!orders.length){
      box.innerHTML = `<div class="help">No orders yet.</div>`;
      return;
    }
    orders.sort((a,b)=> new Date(b.created_at||0) - new Date(a.created_at||0));
    box.innerHTML = orders.map(o=>{
      const oid = o.order_id || o.stripe_session_id || '—';
      const when = o.install_at ? new Date(o.install_at).toLocaleString() : (o.service_date||'');
      const summary = o.order_summary || '';
      const total = (Number(o.order_total)||0);
      return `
        <div class="pd-box" style="margin-bottom:10px">
          <div class="details-grid">
            <div class="row"><div class="k">Order ID</div><div class="v">${escapeHtml(String(oid))}</div></div>
            <div class="row"><div class="k">Total</div><div class="v">${money(total)}</div></div>
            <div class="row"><div class="k">Items</div><div class="v">${escapeHtml(summary||'')}</div></div>
            <div class="row"><div class="k">Service date</div><div class="v">${escapeHtml(when||'—')}</div></div>
          </div>
        </div>
      `;
    }).join('');
  }catch(e){
    box.innerHTML = `<div class="help">Could not load orders.</div>`;
  }
}

window.requestQuote = function(packageId){
  const modal = document.getElementById('quoteModal');
  const backdrop = document.getElementById('backdrop');
  const titleEl = document.getElementById('quoteModalTitle');
  
  if (!modal || !backdrop) return;
  
  if (packageId === 'tv_custom') {
    titleEl.textContent = 'Custom TV Mounting Quote';
  } else if (packageId === 'cam_custom') {
    titleEl.textContent = 'Custom Security Camera Quote';
  } else {
    titleEl.textContent = 'Request Custom Quote';
  }
  
  const detailsField = document.getElementById('quoteDetails');
  if (detailsField) {
    const projectType = packageId === 'tv_custom' ? 'TV mounting' : 'security camera installation';
    detailsField.placeholder = `I need a custom ${projectType} package for...`;
  }
  
  modal.dataset.packageId = packageId;

  try{
    modal.dataset.prevFocus = document.activeElement?.id || '';
  }catch(e){ modal.dataset.prevFocus = ''; }
  
  modal.classList.add('show');
  backdrop.classList.add('show');
  document.body.style.overflow = 'hidden';
  
  setTimeout(() => {
    const nameInput = document.getElementById('quoteName');
    if (nameInput) nameInput.focus();
  }, 100);
};

window.closeQuoteModal = function(){
  const modal = document.getElementById('quoteModal');
  const backdrop = document.getElementById('backdrop');
  
  if (modal) modal.classList.remove('show');
  
  const menuOpen = document.getElementById('menuDrawer')?.classList.contains('open');
  const cartOpen = document.getElementById('cartDrawer')?.classList.contains('open');
  const mainModalOpen = document.getElementById('modal')?.classList.contains('show');
  
  if (!menuOpen && !cartOpen && !mainModalOpen && backdrop) {
    backdrop.classList.remove('show');
  }
  
  document.body.style.overflow = '';
  
  ['quoteName', 'quoteEmail', 'quotePhone', 'quoteDetails'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  const msg = document.getElementById('quoteMessage');
  if (msg) msg.textContent = '';

  try{
    const prevId = modal?.dataset?.prevFocus;
    if(prevId){
      const prevEl = document.getElementById(prevId);
      if(prevEl && typeof prevEl.focus === 'function') prevEl.focus();
    } else {
      const outlet = document.getElementById('outlet');
      if(outlet && typeof outlet.focus === 'function') outlet.focus();
    }
    if(modal && modal.dataset) modal.dataset.prevFocus = '';
  }catch(e){ }
};

window.submitQuoteRequest = async function(){
  const name = document.getElementById('quoteName')?.value.trim() || '';
  const email = document.getElementById('quoteEmail')?.value.trim() || '';
  const phone = document.getElementById('quotePhone')?.value.trim() || '';
  const details = document.getElementById('quoteDetails')?.value.trim() || '';
  const msg = document.getElementById('quoteMessage');
  const btn = document.getElementById('submitQuoteBtn');
  const modal = document.getElementById('quoteModal');
  const packageId = modal?.dataset.packageId || 'unknown';
  
  if (!msg || !btn) return;
  
  if (!name) {
    msg.style.color = '#d32f2f';
    msg.textContent = 'Please enter your name';
    return;
  }
  
  if (!email || !email.includes('@')) {
    msg.style.color = '#d32f2f';
    msg.textContent = 'Please enter a valid email address';
    return;
  }
  
  if (!phone) {
    msg.style.color = '#d32f2f';
    msg.textContent = 'Please enter your phone number';
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Sending...';
  msg.textContent = '';
  
  try {
    const quoteEndpoint = API.replace('/api/shop', '/api/quote');
    
    const response = await fetch(quoteEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        phone,
        details,
        package_type: packageId,
        source: '/shop',
        timestamp: new Date().toISOString()
      })
    });
    
    const data = await response.json();
    
    if (response.ok && data.ok) {
      msg.style.color = '#2e7d32';
      msg.textContent = '✓ Request sent! We\'ll contact you within 1 hour.';
      
      h2sTrack('QuoteRequested', {
        package_type: packageId,
        customer_email: email,
        quote_id: data.quote_id
      });
      
      setTimeout(() => {
        closeQuoteModal();
      }, 2000);
    } else {
      throw new Error(data.error || 'Server error');
    }
  } catch (error) {
    console.error('Quote request failed:', error);
    msg.style.color = '#d32f2f';
    msg.textContent = 'Failed to send. Please call us at (864) 528-1475';
    btn.disabled = false;
    btn.textContent = 'Send Request';
  }
};

// ========================================
// CUSTOM CALENDAR WIDGET
// ========================================

function initializeCustomCalendar(orderId) {
  let availabilityData = [];
  let selectedDate = null;
  let selectedSlot = null;
  let currentMonthOffset = 0;
  
  // Immediately show calendar skeleton (no loading spinner delay)
  byId('calendar-loading').style.display = 'none';
  byId('calendar-view').style.display = 'block';
  
  // Show loading placeholder in calendar
  const today = new Date();
  byId('calendar-month-year').textContent = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  byId('calendar-grid').innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--muted);">
      <div style="width: 40px; height: 40px; border: 3px solid #f3f4f6; border-top-color: var(--azure); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 16px;"></div>
      <div style="font-size: 14px;">Loading availability...</div>
    </div>
  `;
  
  // Fetch availability
  async function loadAvailability() {
    try {
      const response = await fetch('https://h2s-backend-lvl1lgbhs-tabari-ropers-projects-6f2e090b.vercel.app/api/get-availability');
      const data = await response.json();
      
      if (!data.ok) throw new Error(data.error || 'Failed to load availability');
      
      availabilityData = data.availability;
      
      renderCalendar();
    } catch (err) {
      console.error('Calendar load error:', err);
      // Show error in calendar instead of loading state
      byId('calendar-month-year').textContent = 'Error Loading Calendar';
      byId('calendar-grid').innerHTML = `<div style="grid-column: 1 / -1; color: #ef4444; text-align: center; padding: 40px 20px;">${err.message || 'Unable to load availability. Please refresh the page.'}</div>`;
    }
  }
  
  function renderCalendar() {
    const today = new Date();
    today.setMonth(today.getMonth() + currentMonthOffset);
    
    const year = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    byId('calendar-month-year').textContent = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    const grid = byId('calendar-grid');
    
    // Build HTML string (faster than multiple DOM operations)
    let html = '';
    
    // Day labels
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => {
      html += `<div style="text-align: center; font-size: 12px; font-weight: 700; color: var(--muted); padding: 8px; text-transform: uppercase;">${day}</div>`;
    });
    
    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      html += '<div></div>';
    }
    
    // Days of month
    const cells = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(year, month, day);
      const dateStr = dateObj.toISOString().split('T')[0];
      const availability = availabilityData.find(a => a.date === dateStr);
      
      const isSelected = selectedDate === dateStr;
      const isAvailable = availability && availability.available;
      
      const baseStyle = 'aspect-ratio: 1; border: 2px solid; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; transition: all 0.2s;';
      
      if (isSelected) {
        html += `<div data-date="${dateStr}" data-available="${isAvailable}" style="${baseStyle} background: var(--azure); color: white; border-color: var(--azure); cursor: pointer;">${day}</div>`;
      } else if (isAvailable) {
        html += `<div data-date="${dateStr}" data-available="true" style="${baseStyle} background: white; border-color: var(--border); cursor: pointer;">${day}</div>`;
      } else {
        html += `<div style="${baseStyle} background: #f3f4f6; color: #9ca3af; border-color: var(--border); cursor: not-allowed; opacity: 0.5;">${day}</div>`;
      }
      
      if (isAvailable) {
        cells.push({ dateStr, availability });
      }
    }
    
    grid.innerHTML = html;
    
    // Attach event listeners only to available dates (faster than inline handlers)
    cells.forEach(({ dateStr, availability }) => {
      const cell = grid.querySelector(`[data-date="${dateStr}"]`);
      if (cell) {
        cell.onmouseover = () => { 
          if (selectedDate !== dateStr) {
            cell.style.borderColor = 'var(--azure)'; 
            cell.style.background = '#f8f9fb'; 
            cell.style.transform = 'scale(1.05)'; 
          }
        };
        cell.onmouseout = () => { 
          if (selectedDate !== dateStr) { 
            cell.style.borderColor = 'var(--border)'; 
            cell.style.background = 'white'; 
            cell.style.transform = 'scale(1)'; 
          } 
        };
        cell.onclick = () => selectDate(dateStr, availability);
      }
    });
  }
  
  function selectDate(dateStr, availability) {
    selectedDate = dateStr;
    selectedSlot = null;
    
    renderCalendar();
    renderTimeSlots(availability);
    
    byId('calendar-time-slots-container').style.display = 'block';
    byId('calendar-confirm-section').style.display = 'none';
    
    const dateObj = new Date(dateStr + 'T00:00:00');
    byId('calendar-selected-date-label').textContent = `Available times for ${dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
  }
  
  function renderTimeSlots(availability) {
    const container = byId('calendar-time-slots');
    
    // Build HTML string for better performance
    let html = '';
    const availableSlots = [];
    
    availability.slots.forEach((slot, idx) => {
      const baseStyle = 'padding: 16px; border: 2px solid; border-radius: 12px; text-align: center; transition: all 0.2s; font-weight: 600;';
      
      if (slot.available) {
        html += `<div data-slot-idx="${idx}" style="${baseStyle} border-color: var(--border); background: white; cursor: pointer;">
          <div style="margin-bottom: 4px;">${slot.time}</div>
          <div style="font-size: 12px; opacity: 0.8;">${slot.spots_remaining} spot${slot.spots_remaining !== 1 ? 's' : ''} left</div>
        </div>`;
        availableSlots.push({ slot, idx });
      } else {
        html += `<div style="${baseStyle} background: #f3f4f6; color: #9ca3af; border-color: var(--border); cursor: not-allowed; opacity: 0.5;">
          <div>${slot.time}</div>
          <div style="font-size: 12px; margin-top: 4px;">Fully booked</div>
        </div>`;
      }
    });
    
    container.innerHTML = html;
    
    // Attach listeners only to available slots
    availableSlots.forEach(({ slot, idx }) => {
      const slotEl = container.querySelector(`[data-slot-idx="${idx}"]`);
      if (slotEl) {
        slotEl.onmouseover = () => { 
          slotEl.style.borderColor = 'var(--azure)'; 
          slotEl.style.background = '#f8f9fb'; 
          slotEl.style.transform = 'translateY(-2px)'; 
        };
        slotEl.onmouseout = () => { 
          if (!slotEl.classList.contains('selected')) { 
            slotEl.style.borderColor = 'var(--border)'; 
            slotEl.style.background = 'white'; 
            slotEl.style.transform = 'translateY(0)'; 
          } 
        };
        slotEl.onclick = () => selectTimeSlot(slot, slotEl);
      }
    });
  }
  
  function selectTimeSlot(slot, element) {
    selectedSlot = slot;
    
    // Update UI
    byId('calendar-time-slots').querySelectorAll('div').forEach(el => {
      el.style.background = 'white';
      el.style.borderColor = 'var(--border)';
      el.style.color = 'inherit';
    });
    element.style.background = 'var(--azure)';
    element.style.color = 'white';
    element.style.borderColor = 'var(--azure)';
    
    const dateObj = new Date(selectedDate + 'T00:00:00');
    const dateDisplay = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    
    byId('calendar-selected-time-display').textContent = `${dateDisplay} at ${slot.time}`;
    byId('calendar-confirm-section').style.display = 'block';
  }
  
  // Confirm appointment
  byId('calendar-confirm-btn').onclick = async () => {
    if (!selectedDate || !selectedSlot) return;
    
    const btn = byId('calendar-confirm-btn');
    btn.disabled = true;
    btn.textContent = 'Booking...';
    
    try {
      const response = await fetch('https://h2s-backend-lvl1lgbhs-tabari-ropers-projects-6f2e090b.vercel.app/api/schedule-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId,
          delivery_date: selectedDate,
          delivery_time: selectedSlot.time,
          start_iso: selectedSlot.start_iso,
          end_iso: selectedSlot.end_iso,
          timezone: 'America/New_York'
        })
      });
      
      const result = await response.json();
      
      if (!result.ok) throw new Error(result.error || 'Booking failed');
      
      // Show success
      byId('calendar-view').style.display = 'none';
      byId('calendar-success').style.display = 'block';
      
      h2sTrack('AppointmentScheduled', {
        order_id: orderId,
        delivery_date: selectedDate,
        delivery_time: selectedSlot.time
      });
      
    } catch (err) {
      console.error('Booking error:', err);
      byId('calendar-error').textContent = err.message;
      byId('calendar-error').style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Confirm Appointment';
    }
  };
  
  // Month navigation
  byId('calendar-prev-month').onclick = () => {
    if (currentMonthOffset > 0) {
      currentMonthOffset--;
      renderCalendar();
    }
  };
  
  byId('calendar-next-month').onclick = () => {
    if (currentMonthOffset < 2) {
      currentMonthOffset++;
      renderCalendar();
    }
  };
  
  // Start loading
  loadAvailability();
}

console.log('✓ Deferred logic loaded');
