# Tracking Endpoint - Wire Up Instructions

## ✅ Exact Endpoint URL

```
https://h2s-backend.vercel.app/api/track
```

## 📋 Tracking Client Code

Add this script block before `</body>` on all pages:

```html
<!-- ===== TRACKING CLIENT ===== -->
<script>
(function() {
    'use strict';
    
    const TRACK_API = 'https://h2s-backend.vercel.app/api/track';
    const VISITOR_KEY = 'h2s_visitor_id';
    const SESSION_KEY = 'h2s_session_id';
    
    // Get or create visitor ID (persistent across sessions)
    function getVisitorId() {
        let vid = localStorage.getItem(VISITOR_KEY);
        if (!vid) {
            vid = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
            localStorage.setItem(VISITOR_KEY, vid);
        }
        return vid;
    }
    
    // Get or create session ID (per browser session)
    function getSessionId() {
        let sid = sessionStorage.getItem(SESSION_KEY);
        if (!sid) {
            sid = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
            sessionStorage.setItem(SESSION_KEY, sid);
        }
        return sid;
    }
    
    // Extract UTM params from URL
    function extractUTM() {
        const params = new URLSearchParams(window.location.search);
        return {
            utm_source: params.get('utm_source') || null,
            utm_medium: params.get('utm_medium') || null,
            utm_campaign: params.get('utm_campaign') || null,
            utm_term: params.get('utm_term') || null,
            utm_content: params.get('utm_content') || null
        };
    }
    
    // Event queue with retry logic
    const eventQueue = [];
    let isSending = false;
    
    // Send event with retry
    function sendEvent(payload, retries = 1) {
        const useBeacon = navigator.sendBeacon && retries === 1;
        
        if (useBeacon) {
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            if (navigator.sendBeacon(TRACK_API, blob)) {
                return Promise.resolve();
            }
        }
        
        return fetch(TRACK_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true
        })
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .catch(err => {
            if (retries > 0) {
                return new Promise(resolve => {
                    setTimeout(() => {
                        sendEvent(payload, retries - 1).then(resolve).catch(() => resolve());
                    }, 500);
                });
            }
            console.warn('[Tracking] Event failed:', err);
        });
    }
    
    // Track event
    function track(eventType, data = {}) {
        const payload = {
            event: eventType, // Use 'event' for compatibility
            event_type: eventType, // Also include event_type
            occurred_at: new Date().toISOString(),
            visitor_id: getVisitorId(),
            session_id: getSessionId(),
            page_url: window.location.href,
            page_path: window.location.pathname,
            referrer: document.referrer || null,
            user_agent: navigator.userAgent,
            ...extractUTM(),
            ...data
        };
        
        if (data.element_id) payload.element_id = data.element_id;
        if (data.element_text) payload.element_text = data.element_text;
        if (data.metadata) payload.metadata = data.metadata;
        
        if (isSending) {
            eventQueue.push(payload);
        } else {
            isSending = true;
            sendEvent(payload).finally(() => {
                isSending = false;
                if (eventQueue.length > 0) {
                    const next = eventQueue.shift();
                    track(next.event || next.event_type, next);
                }
            });
        }
    }
    
    // Track page view on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            track('page_view');
        });
    } else {
        track('page_view');
    }
    
    // Track clicks on elements with data-track attribute
    document.addEventListener('click', function(e) {
        const target = e.target.closest('[data-track]');
        if (target) {
            const eventType = target.getAttribute('data-track') || 'click';
            const elementId = target.id || target.getAttribute('data-track-id') || null;
            const elementText = target.textContent?.trim().substring(0, 100) || null;
            
            track(eventType, {
                element_id: elementId,
                element_text: elementText
            });
        }
    });
    
    // Track form submissions
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (form.tagName === 'FORM') {
            const formId = form.id || form.getAttribute('data-track-id') || 'unknown_form';
            track('form_submit', {
                element_id: formId,
                element_text: formId
            });
        }
    });
    
    // Track outbound links
    document.addEventListener('click', function(e) {
        const link = e.target.closest('a[href]');
        if (link && link.hostname !== window.location.hostname) {
            track('outbound', {
                element_id: link.id || null,
                element_text: link.textContent?.trim().substring(0, 100) || null,
                metadata: { url: link.href }
            });
        }
    });
    
    // Expose track function globally for manual tracking
    window.h2sTrack = track;
    
    // Track page unload
    window.addEventListener('beforeunload', function() {
        track('page_unload');
    });
})();
</script>
```

## 🎯 Manual Tracking Examples

```javascript
// Track custom events
h2sTrack('purchase', {
  order_id: 'order_123',
  customer_email: 'customer@example.com',
  revenue: 150.00
});

h2sTrack('job_created', {
  job_id: 'job_456',
  order_id: 'order_123'
});

// Track with metadata
h2sTrack('button_click', {
  element_id: 'checkout-btn',
  element_text: 'Checkout',
  metadata: { cart_value: 150.00 }
});
```

## 📄 Pages to Update

- ✅ `funnel-track.html` - Already has tracking
- ⚠️ `bundles.html` - Has h2sTrack but needs endpoint update
- ⚠️ `bundles-success.html` - Needs tracking added
- ⚠️ `schedule.html` - Needs tracking added
- ⚠️ `dispatch.html` - Needs tracking added (optional, internal tool)
- ⚠️ `portalv3.html` - Needs tracking added (optional, internal tool)

