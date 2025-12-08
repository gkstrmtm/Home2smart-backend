// CRITICAL PATH - Minimal functions for onclick handlers
// This executes immediately to ensure all interactive elements work

'use strict';

function byId(id){ return document.getElementById(id); }

// Global state
window.cart = [];
window.user = null;
window.cartOpen = false;
window.menuOpen = false;

// Cart toggle (onclick="toggleCart()")
window.toggleCart = function() {
  window.cartOpen = !window.cartOpen;
  const panel = byId('cartPanel');
  if(panel) {
    panel.classList.toggle('open', window.cartOpen);
    if(window.cartOpen) window.menuOpen = false;
    const menu = byId('menuPanel');
    if(menu) menu.classList.remove('open');
  }
};

// Menu toggle (onclick="toggleMenu()")
window.toggleMenu = function() {
  window.menuOpen = !window.menuOpen;
  const panel = byId('menuPanel');
  if(panel) {
    panel.classList.toggle('open', window.menuOpen);
    if(window.menuOpen) window.cartOpen = false;
    const cart = byId('cartPanel');
    if(cart) cart.classList.remove('open');
  }
};

// Close all panels (onclick="closeAll()")
window.closeAll = function() {
  window.cartOpen = false;
  window.menuOpen = false;
  const cart = byId('cartPanel');
  const menu = byId('menuPanel');
  if(cart) cart.classList.remove('open');
  if(menu) menu.classList.remove('open');
};

// Navigation (onclick="navSet({view:'shop'})")
window.navSet = function(opts) {
  if(!opts || !opts.view) return;
  const url = new URL(window.location);
  url.searchParams.set('view', opts.view);
  if(opts.id) url.searchParams.set('id', opts.id);
  else url.searchParams.delete('id');
  window.history.pushState({}, '', url);
  window.closeAll();
  // Trigger route if main app loaded
  if(window.route) window.route();
};

// Scroll to section (onclick="scrollToSection('tv')")
window.scrollToSection = function(id) {
  const el = byId(id);
  if(el) {
    const offset = 80;
    const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  }
};

// Select package (onclick="selectPackage('basic')")
window.selectPackage = function(tier) {
  console.log('[Critical] Package selected:', tier);
  window._selectedPackage = tier;
  // Main app will handle modal rendering
  if(window.handlePackageSelect) window.handlePackageSelect(tier);
};

// Close modal (onclick="closeModal()")
window.closeModal = function() {
  console.log('[Critical] Close modal');
  if(window.handleCloseModal) window.handleCloseModal();
};

// Quote request (onclick="safeRequestQuote()")
window.safeRequestQuote = function() {
  console.log('[Critical] Quote requested');
  if(window.handleQuoteRequest) window.handleQuoteRequest();
};

window.safeCloseQuoteModal = function() {
  console.log('[Critical] Close quote modal');
  if(window.handleCloseQuoteModal) window.handleCloseQuoteModal();
};

window.submitQuoteRequest = function(e) {
  if(e) e.preventDefault();
  console.log('[Critical] Submit quote');
  if(window.handleSubmitQuote) window.handleSubmitQuote(e);
};

// Add to cart (onclick="addPackageToCart(...)")
window.addPackageToCart = function(tier, price) {
  console.log('[Critical] Add to cart:', tier, price);
  if(window.handleAddToCart) window.handleAddToCart(tier, price);
};

// TV Size modal
window.closeTVSizeModal = function() {
  if(window.handleCloseTVSizeModal) window.handleCloseTVSizeModal();
};

window.confirmTVSize = function(size) {
  console.log('[Critical] TV size:', size);
  if(window.handleConfirmTVSize) window.handleConfirmTVSize(size);
};

// Review navigation
window.goToHeroReview = function(index) {
  if(window.handleGoToReview) window.handleGoToReview(index);
};

// Cart operations
window.updateQuantity = function(index, delta) {
  if(window.handleUpdateQuantity) window.handleUpdateQuantity(index, delta);
};

window.removeFromCart = function(index) {
  if(window.handleRemoveFromCart) window.handleRemoveFromCart(index);
};

window.goToReview = function() {
  if(window.handleGoToReview) window.handleGoToReview();
};

// Urgency banner
window.dismissUrgencyBanner = function() {
  const banner = byId('urgencyBanner');
  if(banner) {
    banner.classList.remove('visible');
    sessionStorage.setItem('h2s_urgency_dismissed', 'true');
  }
};

// Initialize cart count immediately
const cartCount = byId('cartCount');
if(cartCount) cartCount.textContent = '0';

console.log('[Critical] ✓ Onclick handlers ready');

// Load main app asynchronously
const script = document.createElement('script');
script.src = 'bundles-app.js';
script.async = true;
script.onload = () => console.log('[Critical] ✓ Main app loaded');
script.onerror = () => console.error('[Critical] ✗ Failed to load main app');
document.head.appendChild(script);
