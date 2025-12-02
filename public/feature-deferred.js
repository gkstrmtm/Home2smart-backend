// Deferred features: hero reviews, review carousel, urgency banner, tracking & analytics
(function(){
  'use strict';
  try {
    // ===== HERO REVIEWS =====
    // OPTIMIZATION: Removed duplicate initHeroReviews() - now handled in bundles.html for LCP

    // ===== REVIEW CAROUSEL (DEFERRED) =====
    // Uses existing globals: allReviews, renderReviews, loadReviews, etc. Only hydrate if catalog already set.
    if(typeof loadReviews === 'function' && (!window.allReviews || !window.allReviews.length)){
      loadReviews();
    }

    // ===== URGENCY BANNER =====
    function loadUrgencyStats(){
      if(window.__urgencyDismissedEarly) return; // user already dismissed before module loaded
      const dismissedData = localStorage.getItem('h2s_urgency_dismissed');
      if(dismissedData){
        try{
          const hours = (Date.now() - parseInt(dismissedData,10))/(1000*60*60);
          if(hours < 24) return; else localStorage.removeItem('h2s_urgency_dismissed');
        }catch{ localStorage.removeItem('h2s_urgency_dismissed'); }
      }
      fetch((window.API||'').replace('/api/shop','/api/stats'), {headers:{'Accept':'application/json'}})
        .then(r=> r.ok ? r.json(): Promise.reject(new Error('HTTP '+r.status)))
        .then(data=>{
          if(!data.ok || !data.stats) return;
          const banner = document.getElementById('urgencyBanner');
          const msgEl = document.getElementById('urgencyMessage');
          if(!banner || !msgEl) return;
          const stats = data.stats;
          if(stats.bookings_this_week>0){
            const plural = stats.bookings_this_week === 1 ? '' : 's';
            msgEl.textContent = `High demand: ${stats.bookings_this_week} installation${plural} booked this week`;
          } else {
            msgEl.textContent = 'Same-day installation available';
          }
          setTimeout(()=>{
            banner.classList.add('visible');
            // Removed layout shift logic (header/hero push) to improve CLS
          },400);
        }).catch(()=>{});
    }
    function dismissUrgencyBanner(){
      const b=document.getElementById('urgencyBanner');
      if(b){ b.classList.remove('visible'); b.classList.add('dismissed'); }
      // Removed layout shift logic
      try{ localStorage.setItem('h2s_urgency_dismissed', Date.now().toString()); }catch{}
    }
    window.dismissUrgencyBanner = dismissUrgencyBanner;
    loadUrgencyStats();

    // ===== TRACKING SYSTEM =====
    // UPDATED: Point to Vercel Backend instead of Google Apps Script
    window.H2S_DASH_URL = 'https://h2s-backend.vercel.app/api/track';
    
    function generateId(prefix){ return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,11); }
    let sessionId = sessionStorage.getItem('h2s_session_id');
    if(!sessionId){ sessionId = generateId('sess'); sessionStorage.setItem('h2s_session_id', sessionId); }
    let userId = localStorage.getItem('h2s_user_id');
    if(!userId){ userId = generateId('user'); localStorage.setItem('h2s_user_id', userId); }
    window.H2S_TRACKING = { enabled:true, sessionId, userId, pageStartTime: Date.now() };
    function getTrackingURL(){ return window.H2S_DASH_URL; }
    function getUTMParams(){ const p=new URLSearchParams(location.search); return {utm_source:p.get('utm_source')||'',utm_medium:p.get('utm_medium')||'',utm_campaign:p.get('utm_campaign')||'',utm_term:p.get('utm_term')||'',utm_content:p.get('utm_content')||''}; }
    window.sendTrackingEvent = function(ev){
      if(!window.H2S_TRACKING?.enabled) return;
      const data = Object.assign({}, ev, { session_id:sessionId, user_id:userId, timestamp:new Date().toISOString(), page_path:location.pathname, page_title:document.title, referrer:document.referrer||'', user_agent:navigator.userAgent, screen_resolution:screen.width+'x'+screen.height, viewport_size:innerWidth+'x'+innerHeight }, getUTMParams());
      // Vercel endpoint doesn't need ?action=, but we keep it for compatibility if needed
      const url = getTrackingURL(); 
      try{ const payload=JSON.stringify(data); if(navigator.sendBeacon){ const blob=new Blob([payload],{type:'text/plain'}); if(!navigator.sendBeacon(url, blob)) fetch(url,{method:'POST',keepalive:true,body:payload}); } else fetch(url,{method:'POST',keepalive:true,body:payload}); }catch{}
    };
    function getCookie(name){ const m=document.cookie.match(new RegExp('(^| )'+name+'=([^;]+)')); return m?m[2]:''; }
    window.sendMetaPixelEvent = function(name, params={}, evtId){
      if(!window.H2S_TRACKING?.enabled) return;
      const payload = { event_name:name, event_time:Math.floor(Date.now()/1000), event_id:evtId||generateId('evt'), event_source_url:location.href, action_source:'website', user_data:{ client_user_agent:navigator.userAgent, fbc:getCookie('_fbc')||'', fbp:getCookie('_fbp')||'' }, custom_data:params, session_id:sessionId, user_id:userId };
      const url=getTrackingURL();
      try{ const mp=JSON.stringify(payload); if(navigator.sendBeacon){ const blob=new Blob([mp],{type:'text/plain'}); if(!navigator.sendBeacon(url, blob)) fetch(url,{method:'POST',keepalive:true,body:mp}); } else fetch(url,{method:'POST',keepalive:true,body:mp}); }catch{}
    };
    function setupTracking(){
      window.sendTrackingEvent({event_type:'page_view', event_name:'PageView', page_category:'shop'});
      const marks={'25':false,'50':false,'75':false,'100':false};
      window.addEventListener('scroll',()=>{
        const pct=Math.round((scrollY/(document.documentElement.scrollHeight-innerHeight))*100);
        Object.keys(marks).forEach(k=>{ if(pct>=+k && !marks[k]){ marks[k]=true; window.sendTrackingEvent({event_type:'scroll', event_name:'Scroll'+k, scroll_depth:k+'%'}); }});
      },{passive:true});
      window.addEventListener('beforeunload',()=>{ const secs=Math.round((Date.now()-window.H2S_TRACKING.pageStartTime)/1000); window.sendTrackingEvent({event_type:'engagement', event_name:'TimeOnPage', time_seconds:secs}); });
      setTimeout(()=>{ if(typeof fbq!=='undefined'){ const original=fbq; window.fbq=function(){ original.apply(this,arguments); if(arguments[0]==='track'){ window.sendMetaPixelEvent(arguments[1], arguments[2]||{}, (arguments[2]||{}).event_id || (arguments[2]||{}).eventID); } }; } }, 5000);
      document.addEventListener('click', e=>{
        const add=e.target.closest('button[data-product-id], .add-to-cart-btn, .bundle-cta');
        if(add){ const pid=add.getAttribute('data-product-id')||'unknown'; const nameEl=add.getAttribute('data-product-name') || (add.closest('.bundle-card')?.querySelector('h3,.bundle-title')); window.sendTrackingEvent({event_type:'product_interaction', event_name:'AddToCart', product_id:pid, product_name:nameEl?nameEl.textContent.trim():'Bundle', cta_label:add.textContent.trim()}); }
      });
      // Immediate lightweight listeners moved from inline
      document.querySelectorAll('nav a, .h2s-mainnav a').forEach(link=>{
        link.addEventListener('click',()=> window.sendTrackingEvent({event_type:'navigation', event_name:'NavClick', nav_label:link.textContent.trim(), nav_href:link.href}));
      });
      document.querySelectorAll('a[href^="tel:"]').forEach(link=>{
        link.addEventListener('click',()=> window.sendTrackingEvent({event_type:'click', event_name:'PhoneClick', cta_href:link.href}));
      });
      document.querySelectorAll('.checkout-btn, [data-action="checkout"], button[type="submit"][form*="checkout"]').forEach(btn=>{
        btn.addEventListener('click',()=> window.sendTrackingEvent({event_type:'checkout', event_name:'InitiateCheckout', cta_label:btn.textContent.trim()}));
      });
    }
    setupTracking();
  } catch(err){ console.warn('[Deferred] Feature module error', err); }
})();
