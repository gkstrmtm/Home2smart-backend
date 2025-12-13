# Tracking Implementation Prompt

## Objective
Add tracking to frontend pages using the Supabase tracking endpoint. **DO NOT** modify any existing functionality, design, or page behavior. Only add the tracking client script.

## Tracking Endpoint
```
https://h2s-backend.vercel.app/api/track
```

## Requirements

### 1. Performance Constraints
- **MUST** use `navigator.sendBeacon()` for page unload events
- **MUST** use `keepalive: true` for fetch requests
- **MUST** defer non-critical tracking until after page load
- **MUST NOT** block page rendering or user interactions
- **MUST** use `requestIdleCallback` or `setTimeout` for non-critical tracking
- **MUST NOT** add any blocking scripts or styles

### 2. What to Send

The endpoint expects a JSON payload with these fields:

**Required:**
- `event` or `event_type` - Event type (e.g., "page_view", "click", "purchase")
- `visitor_id` - Persistent visitor ID (from localStorage)
- `session_id` - Session ID (from sessionStorage)
- `page_url` - Current page URL
- `page_path` - Current page path

**Optional but recommended:**
- `occurred_at` - ISO timestamp
- `referrer` - Document referrer
- `user_agent` - Browser user agent
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` - UTM parameters from URL
- `element_id` - ID of clicked element (for click events)
- `element_text` - Text content of element (for click events)
- `metadata` - JSON object with additional data (e.g., `order_id`, `job_id`, `customer_email`, `revenue`)

### 3. Implementation Pattern

Add this script block **immediately before `</body>`** tag:

```html
<!-- ===== TRACKING CLIENT ===== -->
<script>
(function() {
    'use strict';
    
    const TRACK_API = 'https://h2s-backend.vercel.app/api/track';
    const VISITOR_KEY = 'h2s_visitor_id';
    const SESSION_KEY = 'h2s_session_id';
    
    // Get or create visitor ID (persistent)
    function getVisitorId() {
        let vid = localStorage.getItem(VISITOR_KEY);
        if (!vid) {
            vid = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
            localStorage.setItem(VISITOR_KEY, vid);
        }
        return vid;
    }
    
    // Get or create session ID (per session)
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
    
    // Send event (performance-optimized)
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
            keepalive: true // Critical for performance
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
            // Silent fail - don't log to console in production
        });
    }
    
    // Track event
    function track(eventType, data = {}) {
        const payload = {
            event: eventType,
            event_type: eventType,
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
        
        // Defer non-critical events to avoid blocking
        if (eventType === 'page_view') {
            // Use requestIdleCallback if available, else setTimeout
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => sendEvent(payload), { timeout: 2000 });
            } else {
                setTimeout(() => sendEvent(payload), 100);
            }
        } else {
            sendEvent(payload);
        }
    }
    
    // Track page view (deferred)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            track('page_view');
        });
    } else {
        // Page already loaded, defer slightly
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => track('page_view'), { timeout: 2000 });
        } else {
            setTimeout(() => track('page_view'), 100);
        }
    }
    
    // Track clicks on elements with data-track attribute (non-blocking)
    document.addEventListener('click', function(e) {
        const target = e.target.closest('[data-track]');
        if (target) {
            const eventType = target.getAttribute('data-track') || 'click';
            track(eventType, {
                element_id: target.id || target.getAttribute('data-track-id') || null,
                element_text: target.textContent?.trim().substring(0, 100) || null
            });
        }
    }, { passive: true }); // Passive listener for performance
    
    // Track form submissions
    document.addEventListener('submit', function(e) {
        if (e.target.tagName === 'FORM') {
            track('form_submit', {
                element_id: e.target.id || 'unknown_form'
            });
        }
    }, { passive: true });
    
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
    }, { passive: true });
    
    // Expose globally for manual tracking
    window.h2sTrack = track;
    
    // Track page unload (use beacon)
    window.addEventListener('beforeunload', function() {
        const payload = {
            event: 'page_unload',
            event_type: 'page_unload',
            occurred_at: new Date().toISOString(),
            visitor_id: getVisitorId(),
            session_id: getSessionId(),
            page_url: window.location.href,
            page_path: window.location.pathname
        };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(TRACK_API, blob);
    });
})();
</script>
```

### 4. Manual Tracking (Optional)

If the page needs to track custom events (e.g., purchase, job_created), use:

```javascript
// Basic event
h2sTrack('button_click', {
  element_id: 'checkout-btn'
});

// With business context (auto-links to orders/jobs in backend)
h2sTrack('purchase', {
  metadata: {
    order_id: 'order_123',
    customer_email: 'customer@example.com',
    revenue: 150.00
  }
});
```

## Rules

### ✅ DO
- Add script immediately before `</body>`
- Use `keepalive: true` for all fetch requests
- Use `navigator.sendBeacon()` for page unload
- Defer `page_view` tracking until after page load
- Use passive event listeners
- Keep script self-contained (IIFE)
- Fail silently (no console errors in production)

### ❌ DON'T
- Modify any existing HTML/CSS/JS
- Change page functionality or design
- Add blocking scripts or styles
- Log errors to console in production
- Add dependencies or external libraries
- Modify existing event handlers
- Change page structure or layout
- Add any visual elements

## Verification

After adding tracking:
1. Open page in browser
2. Check Network tab for POST to `/api/track`
3. Verify `page_view` event is sent (may be deferred)
4. Verify no console errors
5. Verify page performance unchanged (Lighthouse score)

## Example: Adding to a Page

**Before:**
```html
  </div>
</body>
</html>
```

**After:**
```html
  </div>
<!-- ===== TRACKING CLIENT ===== -->
<script>
(function() {
    'use strict';
    // ... (paste full script from section 3)
})();
</script>
</body>
</html>
```

## Notes

- The tracking client is **completely independent** and won't interfere with existing code
- All tracking is **asynchronous** and **non-blocking**
- Events are sent in the background without affecting page performance
- The script uses modern browser APIs with fallbacks for older browsers
- Visitor and session IDs are stored in localStorage/sessionStorage (standard practice)

