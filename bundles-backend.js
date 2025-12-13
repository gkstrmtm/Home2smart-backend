// === VERCEL EDGE FUNCTION: bundles-backend.js ===
// Purpose: Server-side aggregation proxy to eliminate client-side waterfall loading
// Deploy to: /api/bundles-data
// Result: Single API call instead of 5+ = instant First Contentful Paint

export const config = {
  runtime: 'edge', // Use Edge Runtime for <50ms response times globally
};

const SHOP_API = 'https://h2s-backend-5o9147lik-tabari-ropers-projects-6f2e090b.vercel.app/api/shop';
const REVIEWS_API = 'https://h2s-backend-5o9147lik-tabari-ropers-projects-6f2e090b.vercel.app/api/reviews';

export default async function handler(req) {
  // CORS headers for client access
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600', // 5min cache, 10min stale
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    // Parallel fetch all data sources (no waterfall)
    const [catalogRes, reviewsRes] = await Promise.all([
      fetch(`${SHOP_API}?action=catalog&_cb=${Date.now()}`).catch(() => null),
      fetch(`${REVIEWS_API}?limit=20&verified=true`).catch(() => null),
    ]);

    // Parse responses in parallel
    const [catalog, reviews] = await Promise.all([
      catalogRes?.ok ? catalogRes.json() : { services: [], bundles: [], recommendations: [] },
      reviewsRes?.ok ? reviewsRes.json() : { reviews: [] },
    ]);

    // Build aggregated response
    const payload = {
      catalog: {
        services: catalog.services || [],
        serviceOptions: catalog.serviceOptions || [],
        priceTiers: catalog.priceTiers || [],
        bundles: catalog.bundles || [],
        bundleItems: catalog.bundleItems || [],
        recommendations: catalog.recommendations || [],
        memberships: catalog.memberships || [],
        membershipPrices: catalog.membershipPrices || [],
      },
      reviews: (reviews.reviews || []).slice(0, 20),
      meta: {
        cached_at: new Date().toISOString(),
        ttl: 300,
      },
    };

    return new Response(JSON.stringify(payload), { status: 200, headers });

  } catch (error) {
    console.error('[bundles-backend] Aggregation error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to load bundle data',
        catalog: { services: [], bundles: [] },
        reviews: [],
      }), 
      { status: 500, headers }
    );
  }
}

// === STATE ===
let catalog = { services:[], serviceOptions:[], priceTiers:[], bundles:[], bundleItems:[], recommendations:[], memberships:[], membershipPrices:[] };
let cart = loadCart();
let user = loadUser();

// === LOADER UTILITIES ===
function buildLoader(text){
  const div = document.createElement('div');
  div.className = 'loader-overlay';
  div.innerHTML = `
    <div class="loader-spinner"></div>
    <div class="loader-text">${text}</div>
  `;
  return div;
}

function showLoader(text = 'Loading...') {
  const existing = document.querySelector('.loader-overlay');
  if (existing) existing.remove();
  document.body.appendChild(buildLoader(text));
}

function hideLoader() {
  const loader = document.querySelector('.loader-overlay');
  if (loader) loader.remove();
}

function showSkeleton(containerId, count = 4) {
  const container = byId(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.className = 'skeleton-card';
    div.innerHTML = `
      <div class="skeleton-title"></div>
      <div class="skeleton-text"></div>
      <div class="skeleton-text short"></div>
    `;
    container.appendChild(div);
  }
}

// === TRACKING ===
function h2sTrack(eventName, params = {}) {
  if (!SESSION_ID) {
    console.warn('[h2sTrack] No SESSION_ID');
    return;
  }
  const payload = {
    event_id: `${SESSION_ID}_${Date.now()}_${Math.random().toString(36).substring(2,9)}`,
    event_name: eventName,
    url: window.location.href,
    ...params
  };
  fetch('https://h2s-backend-5o9147lik-tabari-ropers-projects-6f2e090b.vercel.app/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(err => console.error('[h2sTrack] error:', err));
}

async function sha256(str) {
  const enc = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function buildAdvancedParams(email = '') {
  const params = {
    event_time: Math.floor(Date.now() / 1000),
    event_source_url: window.location.href,
    action_source: 'website'
  };
  if (email) {
    params.user_data = { em: [await sha256(email.toLowerCase())] };
  }
  return params;
}

// === UTILITY FUNCTIONS ===
function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// === CART MODEL ===
function saveCart() {
  sessionStorage.setItem('h2s_cart', JSON.stringify(cart));
}

function loadCart() {
  try {
    const stored = sessionStorage.getItem('h2s_cart');
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to load cart:', e);
  }
  return [];
}

function loadUser() {
  try {
    const stored = sessionStorage.getItem('h2s_user');
    return stored ? JSON.parse(stored) : null;
  } catch (e) {
    return null;
  }
}

// === INIT ===
async function init() {
  console.log('[bundles-app.js] Initializing...');
  await fetchCatalogFromAPI();
  wireCart();
  updateCartBadge();
  
  const params = await buildAdvancedParams();
  h2sTrack('page_view', params);

  const menuBtn = document.querySelector('.menu-toggle');
  if (menuBtn) menuBtn.addEventListener('click', toggleMenu);
  
  console.log('[bundles-app.js] Initialization complete');
}

// === CATALOG ===
async function fetchCatalogFromAPI() {
  try {
    showLoader('Loading packages...');
    const res = await fetch(`${API}?action=catalog&_cb=${Date.now()}`);
    if (!res.ok) throw new Error('Catalog fetch failed');
    catalog = await res.json();
    console.log('[bundles-app.js] Catalog loaded:', catalog);
  } catch (err) {
    console.error('Failed to fetch catalog:', err);
  } finally {
    hideLoader();
  }
}

// === SELECT PACKAGE (called from static HTML buttons) ===
function selectPackage(packageId, packageName, packagePrice) {
  console.log('[bundles-app.js] selectPackage called:', packageId, packageName, packagePrice);
  addPackageToCart(packageId, packageName, packagePrice);
}

// === PACKAGE SELECTION ===
function addPackageToCart(pkgId, pkgName, pkgPrice) {
  // Support both catalog-based and direct parameter approach
  let itemName, itemPrice;
  
  if (pkgName && pkgPrice) {
    // Direct parameters from static HTML
    itemName = pkgName;
    itemPrice = pkgPrice * 100; // Convert dollars to cents
  } else {
    // Catalog lookup
    const pkg = catalog.bundles.find(b => b.bundle_id == pkgId);
    if (!pkg) {
      console.warn('[bundles-app.js] Package not found:', pkgId);
      return;
    }
    itemName = pkg.name;
    itemPrice = pkg.price;
  }
  
  const lineItem = {
    type: 'bundle',
    bundle_id: pkgId,
    name: itemName,
    price: itemPrice,
    quantity: 1
  };
  
  cart.push(lineItem);
  saveCart();
  paintCart();
  updateCartBadge();
  toggleCart();

  h2sTrack('add_to_cart', {
    content_ids: [pkgId],
    content_name: itemName,
    content_type: 'product',
    value: itemPrice,
    currency: 'USD'
  });
}

// === CART DISPLAY ===
function paintCart() {
  const container = byId('cartItems');
  if (!container) return;
  
  if (cart.length === 0) {
    container.innerHTML = '<p class="cart-empty">Your cart is empty</p>';
    byId('cartSubtotal').textContent = '$0.00';
    if (byId('checkoutBtn')) byId('checkoutBtn').disabled = true;
    return;
  }
  
  container.innerHTML = cart.map((item, idx) => {
    const title = item.name || 'Unknown Item';
    const price = item.price || 0;
    const qty = item.quantity || 1;
    return `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-title">${escapeHtml(title)}</div>
          <div class="cart-item-price">${money(price)}</div>
        </div>
        <div class="cart-item-actions">
          <button class="qty-btn" onclick="window.updateQuantity(${idx}, -1)">−</button>
          <span class="qty-display">${qty}</span>
          <button class="qty-btn" onclick="window.updateQuantity(${idx}, 1)">+</button>
          <button class="remove-btn" onclick="window.removeFromCart(${idx})">✕</button>
        </div>
      </div>
    `;
  }).join('');
  
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  byId('cartSubtotal').textContent = money(subtotal);
  if (byId('checkoutBtn')) byId('checkoutBtn').disabled = false;
}

function updateQuantity(idx, delta) {
  cart[idx].quantity = Math.max(1, (cart[idx].quantity || 1) + delta);
  saveCart();
  paintCart();
  updateCartBadge();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  saveCart();
  paintCart();
  updateCartBadge();
}

function updateCartBadge() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const badge = document.querySelector('.cart-badge');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  }
}

// === UI TOGGLES ===
function toggleMenu() {
  document.body.classList.toggle('menu-open');
}

function toggleCart() {
  document.body.classList.toggle('cart-open');
}

// === WIRE CART PANEL ===
function wireCart() {
  const cartBtn = document.querySelector('.cart-btn');
  if (cartBtn) cartBtn.addEventListener('click', toggleCart);
  
  const checkoutBtn = byId('checkoutBtn');
  if (checkoutBtn) checkoutBtn.addEventListener('click', checkout);
  
  paintCart();
}

// === CHECKOUT ===
// === GLOBAL EXPORTS ===
window.selectPackage = selectPackage;
window.addPackageToCart = addPackageToCart;
window.updateQuantity = updateQuantity;
window.removeFromCart = removeFromCart;
window.toggleMenu = toggleMenu;
window.toggleCart = toggleCart;
window.checkout = checkout;
window.scrollToSection = function(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
};
window.dismissUrgencyBanner = function() {
  const banner = document.getElementById('urgencyBanner');
  if (banner) banner.remove();
};
    value: subtotal,
    currency: 'USD'
  });

  // For now, just alert
  alert('Checkout functionality coming soon! Total: ' + money(subtotal));
}

// === GLOBAL EXPORTS ===
window.addPackageToCart = addPackageToCart;
window.updateQuantity = updateQuantity;
window.removeFromCart = removeFromCart;
window.toggleMenu = toggleMenu;
window.toggleCart = toggleCart;
window.checkout = checkout;

// Start app
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
