// Deferred dynamic reviews hydration. Loaded via intersection or idle.
(function(){
  'use strict';
  if(!window.allReviews || !Array.isArray(window.allReviews) || !window.allReviews.length) return;

  const container = document.getElementById('reviewsSection');
  if(!container) return;

  // Avoid double-build.
  if(container.__hydrated) return; container.__hydrated = true;

  // Prepare track wrapper if not present.
  let track = document.getElementById('reviewTrack');
  if(!track){
    track = document.createElement('div');
    track.id = 'reviewTrack';
    track.style.display = 'flex';
    track.style.transition = 'transform .6s ease';
    track.style.willChange = 'transform';
    container.appendChild(track);
  }

  const raw = window.allReviews.filter(r => r && r.text && r.text.trim());
  const MAX_INITIAL = 30; // limit initial DOM work
  const reviews = raw.slice(0, MAX_INITIAL);

  // Batch size tuned to keep tasks < ~10ms
  const BATCH_SIZE = 6;
  let idx = 0;

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[s]));
  }

  function buildCard(r){
    const card = document.createElement('div');
    card.className = 'review-card';
    card.innerHTML = `
      <div class="review-header">
        <div class="review-avatar">${escapeHtml((r.name||'C').charAt(0).toUpperCase())}</div>
        <div class="review-meta">
          <div class="review-name">${escapeHtml(r.name||'Customer')}</div>
          <div class="review-stars">${'&#9733;'.repeat(r.rating||5)}</div>
        </div>
      </div>
      ${r.text ? `<p class=\"review-text\">${escapeHtml(r.text.trim())}</p>` : ''}
    `;
    return card;
  }

  function renderBatch(){
    const frag = document.createDocumentFragment();
    for(let i=0; i<BATCH_SIZE && idx < reviews.length; i++, idx++){
      frag.appendChild(buildCard(reviews[idx]));
    }
    track.appendChild(frag);
    if(idx < reviews.length){ schedule(); } else { finalize(); }
  }

  function schedule(){
    if('requestIdleCallback' in window){
      requestIdleCallback(renderBatch, {timeout:1500});
    } else {
      setTimeout(renderBatch, 30);
    }
  }

  function finalize(){
    // Setup pagination dots if needed
    const vw = window.innerWidth;
    const perView = vw >= 1024 ? 3 : (vw >= 768 ? 2 : 1);
    const totalPages = Math.ceil(reviews.length / perView);
    if(totalPages > 1){
      let nav = container.querySelector('.review-dots');
      if(!nav){
        nav = document.createElement('div');
        nav.className = 'review-dots';
        container.appendChild(nav);
      }
      nav.innerHTML = Array.from({length: totalPages}, (_, i) => `<div class=\"review-dot ${'${i===0?\'active\':\''}'}\" data-page=\"${'${i}'}\"></div>`).join('');
      let page = 0;
      function go(p){
        page = p; const offset = -page * 100;
        requestAnimationFrame(()=>{ track.style.transform = `translateX(${'${offset}'}%)`; });
        nav.querySelectorAll('.review-dot').forEach((d,i)=>d.classList.toggle('active', i===page));
      }
      nav.addEventListener('click', e=>{
        const d = e.target.closest('.review-dot');
        if(!d) return; go(Number(d.getAttribute('data-page')));
      });
    }
  }

  schedule();
})();
