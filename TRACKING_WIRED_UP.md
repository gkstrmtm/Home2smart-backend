# ✅ Tracking Wired Up - Summary

## Exact Endpoint URL
```
https://h2s-backend.vercel.app/api/track
```

## ✅ Pages Updated

### 1. `funnel-track.html`
- ✅ Already has full tracking client
- ✅ Using correct endpoint

### 2. `bundles.html`
- ✅ Updated `h2sTrack()` function to use new endpoint
- ✅ Enhanced payload format with business entity support
- ✅ Auto-extracts visitor_id and session_id
- ✅ Includes UTM params and metadata

### 3. `bundles-success.html`
- ✅ Added full tracking client
- ✅ Tracks page_view automatically
- ✅ Supports manual tracking via `h2sTrack()`

### 4. `schedule.html`
- ✅ Added full tracking client
- ✅ Tracks page_view automatically
- ✅ Supports manual tracking via `h2sTrack()`

## 📋 How to Use

### Automatic Tracking
All pages now automatically track:
- `page_view` - On page load
- `click` - On elements with `data-track` attribute
- `form_submit` - On form submissions
- `outbound` - On external link clicks

### Manual Tracking
Use `h2sTrack()` function globally:

```javascript
// Basic event
h2sTrack('button_click', {
  element_id: 'checkout-btn'
});

// With business context (auto-links to orders/jobs)
h2sTrack('purchase', {
  order_id: 'order_123',
  customer_email: 'customer@example.com',
  revenue: 150.00
});

h2sTrack('job_created', {
  job_id: 'job_456',
  order_id: 'order_123'
});
```

## 🧪 Test Command

```bash
# PowerShell
$body = @{
    event = "test_event"
    visitor_id = "test-123"
    session_id = "test-456"
    page_url = "https://home2smart.com/test"
    page_path = "/test"
    metadata = @{ test = $true }
} | ConvertTo-Json

Invoke-WebRequest -Uri "https://h2s-backend.vercel.app/api/track" -Method POST -Body $body -ContentType "application/json"
```

## 📊 Next Steps

1. **Deploy schema**: Run `TRACKING_SCHEMA.sql` in Supabase
2. **Test**: Visit pages and check Supabase `h2s_tracking_events` table
3. **Monitor**: Events should appear with business entity links when metadata contains `order_id` or `job_id`

