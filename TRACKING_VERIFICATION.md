# Funnel Tracking System - Verification Guide

## Summary

**What was wrong/missing:**
- Existing tracking was basic: only sent events to `analytics_events` table with minimal structure
- No visitor persistence (only session-level)
- No UTM parameter tracking
- No deduplication/idempotency
- No structured schema for attribution analysis
- Inconsistent payload structure across pages

**What is now fixed:**
- ✅ Complete SQL schema with visitors, sessions, events, and funnel_attribution tables
- ✅ Visitor ID persistence across sessions (localStorage)
- ✅ Session ID per browser session (sessionStorage)
- ✅ UTM parameter extraction and storage (first/last)
- ✅ Deduplication via `dedupe_key` to prevent duplicate events
- ✅ IP hashing (SHA-256 of IP + user-agent) for privacy
- ✅ Automatic page_view, click, form_submit, outbound tracking
- ✅ Consistent payload structure matching existing `h2sTrack` pattern
- ✅ Retry logic (1 retry max) for failed sends
- ✅ Uses `navigator.sendBeacon` when available for page unload

## Test Commands

### 1. Health Check (GET /api/track-ping)
```bash
curl -X GET "https://h2s-backend.vercel.app/api/track-ping"
```

**Expected Response:**
```json
{
  "ok": true,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 2. Test Event (POST /api/track)
```bash
curl -X POST "https://h2s-backend.vercel.app/api/track" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "page_view",
    "page_url": "https://home2smart.com/test",
    "page_path": "/test",
    "visitor_id": "test-visitor-123",
    "session_id": "test-session-456",
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "test_campaign"
  }'
```

**Expected Response:**
```json
{
  "ok": true,
  "event_id": "uuid-here",
  "visitor_id": "test-visitor-123",
  "session_id": "test-session-456",
  "deduped": false
}
```

### 3. Test Duplicate Event (should be deduped)
```bash
# Send same event twice (same session_id, event_type, page_path, within same minute)
curl -X POST "https://h2s-backend.vercel.app/api/track" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "click",
    "page_url": "https://home2smart.com/test",
    "page_path": "/test",
    "visitor_id": "test-visitor-123",
    "session_id": "test-session-456",
    "element_id": "button-1"
  }'

# Send again immediately (should return deduped: true)
curl -X POST "https://h2s-backend.vercel.app/api/track" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "click",
    "page_url": "https://home2smart.com/test",
    "page_path": "/test",
    "visitor_id": "test-visitor-123",
    "session_id": "test-session-456",
    "element_id": "button-1"
  }'
```

## Supabase Verification Checklist

After running the SQL schema and sending test events:

### 1. Check Visitors Table
```sql
SELECT 
  visitor_id,
  first_seen_at,
  last_seen_at,
  first_utm_campaign,
  last_utm_campaign,
  first_referrer
FROM h2s_tracking_visitors
ORDER BY first_seen_at DESC
LIMIT 10;
```

**Expected:** Rows with visitor_id, timestamps, UTM params if provided

### 2. Check Sessions Table
```sql
SELECT 
  session_id,
  visitor_id,
  started_at,
  last_event_at,
  landing_page_url,
  landing_path
FROM h2s_tracking_sessions
ORDER BY started_at DESC
LIMIT 10;
```

**Expected:** Rows linked to visitors, with landing page info

### 3. Check Events Table
```sql
SELECT 
  event_id,
  occurred_at,
  visitor_id,
  session_id,
  event_type,
  page_path,
  element_id,
  utm_campaign,
  dedupe_key
FROM h2s_tracking_events
ORDER BY occurred_at DESC
LIMIT 20;
```

**Expected:** Event rows with all metadata, dedupe_key populated

### 4. Verify Deduplication
```sql
-- Should return 0 (no duplicate dedupe_keys)
SELECT dedupe_key, COUNT(*) as count
FROM h2s_tracking_events
WHERE dedupe_key IS NOT NULL
GROUP BY dedupe_key
HAVING COUNT(*) > 1;
```

**Expected:** 0 rows (no duplicates)

### 5. Check Indexes
```sql
SELECT 
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename LIKE 'h2s_tracking%'
ORDER BY tablename, indexname;
```

**Expected:** All indexes from schema should exist

## Frontend Testing

### 1. Test funnel-track.html
1. Open `https://home2smart.com/funnel-track.html` (or your GHL page)
2. Open browser DevTools → Network tab
3. Filter for `/api/track`
4. Verify:
   - ✅ `page_view` event sent on load
   - ✅ `visitor_id` and `session_id` in payload
   - ✅ UTM params extracted if in URL
   - ✅ Response returns `{ ok: true, event_id, ... }`

### 2. Test Click Tracking
1. Add `data-track="button_click"` to any button
2. Click the button
3. Verify:
   - ✅ Click event sent with `event_type: "button_click"`
   - ✅ `element_id` and `element_text` in payload

### 3. Test Form Submission
1. Submit any form on the page
2. Verify:
   - ✅ `form_submit` event sent
   - ✅ Form ID captured

### 4. Test Visitor Persistence
1. Load page → note `visitor_id` in localStorage (`h2s_visitor_id`)
2. Close browser completely
3. Reopen and load page again
4. Verify:
   - ✅ Same `visitor_id` (persisted)
   - ✅ New `session_id` (new session)
   - ✅ Visitor record updated in DB with `last_seen_at`

## Multiple Pages Test

The endpoint is designed to handle multiple pages calling it simultaneously:

1. Open `bundles.html` in one tab
2. Open `funnel-track.html` in another tab
3. Both should send events without collisions
4. Verify in Supabase:
   - ✅ Different `session_id` for each tab
   - ✅ Same `visitor_id` if same browser (localStorage shared)
   - ✅ All events stored correctly

## Common Issues & Fixes

### Issue: Events not appearing in Supabase
- **Check:** Vercel logs for errors
- **Check:** Supabase RLS policies (should allow service role)
- **Check:** `SUPABASE_SERVICE_ROLE_KEY` env var is set

### Issue: Duplicate events
- **Check:** `dedupe_key` is being generated correctly
- **Check:** Events are within same minute bucket (dedupe window)

### Issue: Visitor not persisting
- **Check:** localStorage is enabled in browser
- **Check:** No private/incognito mode (localStorage may be cleared)

### Issue: UTM params not captured
- **Check:** URL has UTM params: `?utm_source=google&utm_campaign=test`
- **Check:** Params are extracted in `extractUTM()` function

## Next Steps

1. ✅ Run SQL schema in Supabase SQL Editor
2. ✅ Deploy updated `api/track.js` and `api/track-ping.js` to Vercel
3. ✅ Test with curl commands above
4. ✅ Verify data in Supabase tables
5. ✅ Test `funnel-track.html` in browser
6. ✅ Add `data-track` attributes to key CTAs on other pages
7. ✅ Monitor Vercel logs for any errors

