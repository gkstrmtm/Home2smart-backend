(()=>{
'use strict';

// === API CONFIG ===
const API = 'https://h2s-backend.vercel.app/api/shop';
// APIV1 (GAS) removed - migrated to Vercel
const DASH_URL = 'https://h2s-backend.vercel.app/api/track';
const CAL_FORM_URL = 'https://api.leadconnectorhq.com/widget/booking/RjwOQacM3FAjRNCfm6uU';
const PIXEL_ID = '2384221445259822';

// Session ID for tracking
let SESSION_ID = sessionStorage.getItem('h2s_session_id');
if(!SESSION_ID){
  SESSION_ID = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
  sessionStorage.setItem('h2s_session_id', SESSION_ID);
}

// === STATE ===
let catalog = { services:[], serviceOptions:[], priceTiers:[], bundles:[], bundleItems:[], recommendations:[], memberships:[], membershipPrices:[] };
let cart = loadCart();
let user = loadUser();
let lastSearch = '';
let lastCat = '';

// === LOADER ===
function buildLoader(){
  const slices = byId('h2sLoaderSlices');
  if(!slices) return;
  const c1 = '#1493ff', c2 = '#0a2a5a', c3 = '#6b778c';
  const colors = [c1, c2, c3, c1, c2, c3, c1, c2];
  slices.innerHTML = colors.map((col, i)=>`<div class="h2s-loader-slice" style="background:${col};animation-delay:${i*0.05}s"></div>`).join('');
}
function showLoader(){ 
  const el=byId('h2s-loader'); 
  if(el){ 
    el.classList.remove('hidden');
    el.style.display=''; 
  } 
}
function hideLoader(){ 
  const el=byId('h2s-loader'); 
  if(el){ 
    el.classList.add('hidden');
    // Remove from DOM after transition
    setTimeout(() => { if(el.classList.contains('hidden')) el.style.display='none'; }, 400);
  } 
}

// Show skeleton loading state while content loads
function showSkeleton(){
  byId('outlet').innerHTML = `
    <div class="skeleton skeleton-hero"></div>
    <div class="skeleton skeleton-trust"></div>
    <div class="skeleton-grid">
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>
  `;
}

// === META PIXEL + TRACKING ===
function h2sTrack(event, data={}){
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    session_id: SESSION_ID,
    user_email: user?.email||'',
    url: location.href,
    ...data
  };
  
  // Send to Meta Pixel if loaded
  if(typeof fbq !== 'undefined'){
    const params = buildAdvancedParams();
    fbq('track', event, data, params);
  }
  
  // Send to dashboard webhook
  fetch(DASH_URL, {
    method:'POST',
    body: JSON.stringify(payload)
  }).catch(err => console.warn('Dashboard track failed:', err));
}

async function sha256(text){
  if(!crypto || !crypto.subtle) return '';
  try{
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }catch(_){ return ''; }
}

function buildAdvancedParams(){
  const params = {};
  if(user && user.email){
    sha256(user.email.trim().toLowerCase()).then(h => { if(h) params.em = h; });
    if(user.phone){
      const digits = user.phone.replace(/\D/g,'');
      sha256(digits).then(h => { if(h) params.ph = h; });
    }
    if(user.name){
      const parts = user.name.trim().toLowerCase().split(' ');
      if(parts[0]) sha256(parts[0]).then(h => { if(h) params.fn = h; });
      if(parts[parts.length-1]) sha256(parts[parts.length-1]).then(h => { if(h) params.ln = h; });
    }
  }
  return params;
}

// === INIT ===
async function init(){
  console.log('App initializing...');
  
  try {
    // PHASE 1: INSTANT - Minimal critical setup (target <50ms)
    // Prevent browser from auto-scrolling to hash on page load
    const hash = window.location.hash;
    if (hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    
    // Mark page as ready immediately for static content
    document.body.classList.add('app-ready');
    
    // PHASE 2: FAST - Essential UI (target <100ms)
    // Defer non-critical UI setup
    requestAnimationFrame(() => {
      buildLoader();
      wireCart();
      updateCartBadge();
      paintCart();
    });
    
    // PHASE 3: DETERMINE VIEW - Quick routing decision
    const view = getParam('view');
    const isSpecialView = view && view !== 'shop';
    
    // PHASE 4: RENDER IMMEDIATELY - Don't wait for anything
    route(); // Shows static content instantly for shop view
    
    // PHASE 5: BACKGROUND LOADS - Everything else happens after render
    requestIdleCallback(() => {
      // Load catalog in background
      fetch(API + '?action=catalog', { 
        cache: 'default',
        headers: { 'Accept': 'application/json' }
      }).then(res => res.json()).then(data => {
        if(data.ok){
          catalog = data.catalog || catalog;
          console.log('✓ Catalog loaded:', catalog.bundles?.length || 0, 'bundles');
          // Re-render only if needed (not on shop view with static content)
          if (isSpecialView) route();
        }
      }).catch(err => {
        console.error('Catalog fetch failed:', err);
      });
    }, { timeout: 1000 });
    
    // Handle cart from URL
    const urlCart = getParam('cart');
    if(urlCart){
      requestAnimationFrame(() => {
        const decoded = decodeCartFromUrl(urlCart);
        if(decoded.length){
          cart = decoded;
          saveCart();
          updateCartBadge();
          paintCart();
        }
      });
    }
    
    // Clean URL - remove cart parameter
    const url = new URL(location.href);
    if(url.searchParams.has('cart')){
      url.searchParams.delete('cart');
      history.replaceState({}, '', url.toString());
    }
    
    // PHASE 6: DEFERRED FEATURES - Load after page is interactive
    // AI recommendations (only if signed in)
    if(user && user.email){
      requestIdleCallback(() => loadAIRecommendations(), { timeout: 3000 });
    }
    
    // Meta Pixel (deferred, low priority)
    if('requestIdleCallback' in window){
      requestIdleCallback(() => {
        try {
          const script = document.createElement('script');
          script.innerHTML = `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${PIXEL_ID}');
            fbq('track', 'PageView');
          `;
          document.head.appendChild(script);
          
          const noscript = document.createElement('noscript');
          noscript.innerHTML = `<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1"/>`;
          document.body.appendChild(noscript);
        } catch(e) { console.warn('Pixel init failed', e); }
      }, { timeout: 3000 });
    }
    
    // PHASE 7: ANALYTICS - Track page view (lowest priority)
    requestAnimationFrame(() => {
      h2sTrack('PageView');
    });
    
    console.log('✓ App ready');
  } catch (err) {
    console.error('Critical initialization error:', err);
    // Fallback: show content anyway
    document.body.classList.add('app-ready');
  }
}

// Fetch latest catalog from backend. If cacheBust is true, append a timestamp to force bypass.
async function fetchCatalogFromAPI(cacheBust = false){
  try{
    const url = API + '?action=catalog' + (cacheBust ? '&cb=' + Date.now() : '');
    console.log('[Catalog] Fetching catalog from API', cacheBust ? '(cache-bust)' : '');
    const res = await fetch(url, { cache: 'no-store' });
    if(!res.ok){
      console.warn('[Catalog] HTTP', res.status);
      return false;
    }
    const data = await res.json();
    if(data && data.ok && data.catalog){
      catalog = data.catalog;
      console.log('[Catalog] Updated local catalog. Bundles:', catalog.bundles?.length || 0);
      return true;
    }
    console.warn('[Catalog] Unexpected response while fetching catalog', data);
    return false;
  }catch(err){
    console.warn('[Catalog] Fetch failed:', err);
    return false;
  }
}

// === ROUTING ===
function route(){
  const view = getParam('view');
  
  console.log('[Route] Routing to view:', view || 'shop');
  
  // Close any open modals/drawers when navigating
  closeAll();
  
  if(view === 'signin'){ renderSignIn(); return; }
  if(view === 'signup'){ renderSignUp(); return; }
  if(view === 'account'){ renderAccount(); return; }
  if(view === 'forgot'){ renderForgot(); return; }
  if(view === 'reset'){ renderReset(getParam('token')); return; }
  if(view === 'shopsuccess'){ renderShopSuccess(); return; }
  if(view === 'calreturn' || view === 'apptreturn'){ handleCalReturn(); return; }
  
  // Default: show shop
  const outlet = byId('outlet');
  if (!outlet) {
    console.error('[Route] Outlet element not found!');
    return;
  }
  
  const hasShopContent = outlet.querySelector('.hero');
  
  if (!hasShopContent) {
    console.log('[Route] No shop content found, rendering shop');
    renderShop();
  } else {
    // Static shop content already loaded, ensure it's visible
    console.log('[Route] Shop content exists, making visible');
    outlet.style.opacity = '1';
    outlet.style.transition = '';
    document.body.classList.add('app-ready');
    
    // Re-initialize hero reviews if they haven't loaded
    const heroReviews = document.getElementById('heroReviews');
    if (heroReviews && !heroReviews.querySelector('.review-card')) {
      console.log('[Route] Initializing hero reviews');
      initHeroReviews();
    }
  }
}

function renderShop(){
  // Mark as transitioning
  const outlet = byId('outlet');
  outlet.style.opacity = '0';
  outlet.style.transition = 'opacity 0.3s ease';
  
  // Small delay for smooth transition
  setTimeout(() => {
    outlet.innerHTML = `
<!-- HERO -->
<section class="hero content-reveal">
  <div class="hero-inner">
    <h1>Expert Installation.<br>Done Right.</h1>
    <p>TV Mounting & Security Cameras. Pick a package, we handle the rest. Simple pricing, instant booking.</p>
    <div class="hero-ctas">
      <button class="btn btn-primary" onclick="scrollToSection('tv')">
        Shop TV Packages
      </button>
      <button class="btn btn-ghost" onclick="scrollToSection('security')">
        Shop Security
      </button>
    </div>
    
    <!-- Hero Review Carousel -->
    <div class="hero-reviews" id="heroReviews">
      <!-- Reviews will be injected here by JavaScript -->
    </div>
  </div>
</section>

<!-- TRUST BAR -->
<section class="trust-bar content-reveal reveal-delay-1">
  <div class="trust-inner">
    <div class="trust-item">
      <strong>500+</strong>
      <span>Homes Served</span>
    </div>
    <div class="trust-item">
      <strong>4.9★</strong>
      <span>Average Rating</span>
    </div>
    <div class="trust-item">
      <strong>Licensed</strong>
      <span>& Insured</span>
    </div>
    <div class="trust-item">
      <strong>Same-Day</strong>
      <span>Service Available</span>
    </div>
  </div>
</section>

<!-- TV MOUNTING SECTION -->
<section class="section content-reveal reveal-delay-2" id="tv">
  <div class="section-header">
    <h2>How many TVs?</h2>
    <p>Clean installs, same-day setup. First TV $249, each additional discounted.</p>
  </div>

  <div class="package-grid">
    <!-- Single TV -->
    <article class="package">
      <div class="package-header">
        <h3 class="package-name">Single TV Mount</h3>
        <div class="package-price">$249</div>
      </div>
      <p class="package-promise">One TV mounted clean and ready to watch tonight.</p>
      <div class="package-includes">
        <strong>What's Included</strong>
        <ul>
          <li>TV securely mounted</li>
          <li>All wires hidden</li>
          <li>Streaming setup</li>
          <li>Ready to go</li>
        </ul>
      </div>
      <button class="btn btn-primary" onclick="selectPackage('tv_single', 'Single TV Mount', 249)">
        Add to Cart
      </button>
    </article>

    <!-- 2-TV Package (FEATURED) -->
    <article class="package featured">
      <div class="package-header">
        <h3 class="package-name">2-TV Package</h3>
        <div class="package-price">$428 <small style="opacity:.6">(save $70)</small></div>
      </div>
      <p class="package-promise">Two rooms, theater-ready. Same visit, better deal.</p>
      <div class="package-includes">
        <strong>What's Included</strong>
        <ul>
          <li>Both TVs mounted</li>
          <li>All wiring concealed</li>
          <li>Streaming on both</li>
          <li>One appointment</li>
        </ul>
      </div>
      <button class="btn btn-primary" onclick="selectPackage('tv_2pack', '2-TV Package', 428)">
        Add to Cart
      </button>
    </article>

    <!-- Multi-Room -->
    <article class="package">
      <div class="package-header">
        <h3 class="package-name">Multi-Room (3-4 TVs)</h3>
        <div class="package-price">$749-$899</div>
      </div>
      <p class="package-promise">Whole-home entertainment in one visit.</p>
      <div class="package-includes">
        <strong>What's Included</strong>
        <ul>
          <li>3-4 TVs mounted</li>
          <li>All wiring concealed</li>
          <li>Streaming + soundbar</li>
          <li>Universal remote</li>
        </ul>
      </div>
      <button class="btn btn-primary" onclick="selectPackage('tv_multi', 'Multi-Room Package', 749)">
        Add to Cart
      </button>
    </article>

    <!-- Custom -->
    <article class="package">
      <div class="package-header">
        <h3 class="package-name">5+ TVs (Custom)</h3>
        <div class="package-price">Request Quote</div>
      </div>
      <p class="package-promise">Large properties or commercial setups—we'll design a plan.</p>
      <div class="package-includes">
        <strong>What's Included</strong>
        <ul>
          <li>Site consultation</li>
          <li>Custom wiring plan</li>
          <li>Volume pricing</li>
          <li>Project manager</li>
        </ul>
      </div>
      <button class="btn btn-secondary" onclick="requestQuote('tv_custom')">
        Request Quote
      </button>
    </article>
  </div>
</section>

<!-- SECURITY CAMERAS SECTION -->
<section class="section" id="security">
  <div class="section-header">
    <h2>How many cameras do you need?</h2>
    <p>Front door only, full perimeter, or something in between—we'll cover what matters. Great for homes, storefronts, warehouses, and offices.</p>
  </div>

  <div class="package-grid">
    <!-- Basic Coverage -->
    <article class="package">
      <div class="package-header">
        <h3 class="package-name">Basic Coverage</h3>
        <div class="package-price">$599</div>
      </div>
      <p class="package-promise">Front door secure. See who's there, every time.</p>
      <div class="package-includes">
        <strong>What's Included</strong>
        <ul>
          <li>2 cameras + doorbell</li>
          <li>Mobile alerts</li>
          <li>7-day cloud storage</li>
          <li>App setup</li>
        </ul>
      </div>
      <button class="btn btn-primary" onclick="selectPackage('cam_basic', 'Basic Coverage', 599)">
        Add to Cart
      </button>
    </article>

    <!-- Standard Coverage (FEATURED) -->
    <article class="package featured">
      <div class="package-header">
        <h3 class="package-name">Standard Coverage</h3>
        <div class="package-price">$1,199</div>
      </div>
      <p class="package-promise">Front, driveway, and backyard—full visibility where it matters.</p>
      <div class="package-includes">
        <strong>What's Included</strong>
        <ul>
          <li>4 cameras + doorbell</li>
          <li>Mobile alerts</li>
          <li>30-day cloud storage</li>
          <li>App + pro setup</li>
        </ul>
      </div>
      <button class="btn btn-primary" onclick="selectPackage('cam_standard', 'Standard Coverage', 1199)">
        Add to Cart
      </button>
    </article>

    <!-- Premium Coverage -->
    <article class="package">
      <div class="package-header">
        <h3 class="package-name">Premium Coverage</h3>
        <div class="package-price">$2,199</div>
      </div>
      <p class="package-promise">Full perimeter + NVR recording. Total property protection.</p>
      <div class="package-includes">
        <strong>What's Included</strong>
        <ul>
          <li>8 cameras + doorbell</li>
          <li>Local NVR recording</li>
          <li>60-day cloud storage</li>
          <li>Dedicated support</li>
        </ul>
      </div>
      <button class="btn btn-primary" onclick="selectPackage('cam_premium', 'Premium Coverage', 2199)">
        Add to Cart
      </button>
    </article>

    <!-- Custom -->
    <article class="package">
      <div class="package-header">
        <h3 class="package-name">Custom Security</h3>
        <div class="package-price">Request Quote</div>
      </div>
      <p class="package-promise">Businesses, estates, unique needs—custom designs available.</p>
      <div class="package-includes">
        <strong>What's Included</strong>
        <ul>
          <li>Site survey</li>
          <li>Custom camera plan</li>
          <li>Volume pricing</li>
          <li>Ongoing support</li>
        </ul>
      </div>
      <button class="btn btn-secondary" onclick="requestQuote('cam_custom')">
        Request Quote
      </button>
    </article>
  </div>
</section>
  `;
    
    // Fade back in
    requestAnimationFrame(() => {
      outlet.style.opacity = '1';
      document.body.classList.add('app-ready');
    });
  }, 50);
  
  // Re-init hero reviews
  initHeroReviews();
  
  // Update signin state
  renderSigninState();
  
  // Scroll to top
  window.scrollTo(0, 0);
}

function navSet(params){
  const u = new URL(location.href);
  Object.entries(params||{}).forEach(([k,v])=>{
    if(v==null) u.searchParams.delete(k); else u.searchParams.set(k,v);
  });
  history.pushState({}, '', u.toString());
  route();
}

function getParam(k){
  const u = new URL(location.href);
  return u.searchParams.get(k);
}

// === MENU / CART / MODAL TOGGLES ===
function toggleMenu(){
  const menu = byId('menuDrawer');
  const backdrop = byId('backdrop');
  if(!menu || !backdrop) return;
  
  const isOpen = menu.classList.contains('open');
  
  if(isOpen){
    menu.classList.remove('open');
    backdrop.classList.remove('show');
  }else{
    closeAll();
    menu.classList.add('open');
    backdrop.classList.add('show');
  }
}

function toggleCart(){
  const drawer = byId('cartDrawer');
  const backdrop = byId('backdrop');
  const isOpen = drawer.classList.contains('open');
  
  if(isOpen){
    drawer.classList.remove('open');
    backdrop.classList.remove('show');
  }else{
    closeAll();
    drawer.classList.add('open');
    backdrop.classList.add('show');
    paintCart();
  }
}

function closeAll(){
  byId('menuDrawer').classList.remove('open');
  byId('cartDrawer').classList.remove('open');
  byId('backdrop').classList.remove('show');
  closeModal();
  closeQuoteModal();
}

function showModal(){
  closeAll();
  byId('modal').classList.add('show');
  byId('backdrop').classList.add('show');
}

function closeModal(){
  byId('modal').classList.remove('show');
  if(!byId('menuDrawer').classList.contains('open') && !byId('cartDrawer').classList.contains('open')){
    byId('backdrop').classList.remove('show');
  }
}

// [Remaining 3,500 lines of code continue here - truncated for brevity]
// The full file contains all functions from lines 2750-6495
