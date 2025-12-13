# Tracking System Migration - Complete

## ✅ All Google Apps Script & Sheets References Removed

The tracking system has been completely rebuilt to use **Supabase only**. All data flows directly to the database with intelligent business entity linking.

## What Changed

### 1. Enhanced Tracking Schema (`TRACKING_SCHEMA.sql`)
- **Events table** now includes direct links to business entities:
  - `order_id` - Links to `h2s_orders.id`
  - `job_id` - Links to `h2s_dispatch_jobs.job_id`
  - `customer_email` - Links to customer records
  - `customer_phone` - For matching
  - `revenue_amount` - Revenue associated with event (from order/job)
- **New indexes** for fast queries on business entity links

### 2. Intelligent Tracking Endpoint (`api/track.js`)
- **Auto-linking**: Automatically links events to orders/jobs/customers when metadata contains:
  - `order_id`, `stripe_session_id` → Looks up order, extracts revenue, customer info
  - `job_id` → Looks up job, extracts revenue, customer info
  - `customer_email` → Attempts to find recent orders (within 24h) for attribution
- **Revenue tracking**: Automatically extracts revenue from orders/jobs
- **Conversion attribution**: Auto-creates `h2s_tracking_funnel_attribution` records for conversion events:
  - `purchase`, `purchase_intent`, `job_created`, `order_created`, `checkout_completed`
- **Business context**: Every event can now be linked to actual business outcomes

### 3. Removed All Apps Script References
- ✅ Removed from `funnel-track.html`:
  - Apps Script API URLs
  - Google Sheets links
  - Apps Script function references
  - Updated to use Supabase queries instead
- ✅ Updated test commands to use curl/SQL instead of Apps Script functions
- ✅ Dashboard functions marked for Supabase migration (placeholder added)

### 4. Business Intelligence
The tracking system now understands your business:
- **Orders**: When an event has `order_id` in metadata, it automatically:
  - Links the event to the order
  - Extracts customer email/phone
  - Captures revenue amount
  - Creates attribution record
- **Jobs**: When an event has `job_id` in metadata, it automatically:
  - Links the event to the job
  - Links to associated order (if exists)
  - Extracts customer info
  - Captures revenue
- **Customers**: When `customer_email` is present, it attempts to:
  - Find recent orders (within 24h) for attribution
  - Link events to customer journey

## How to Use

### Track Events with Business Context

```javascript
// Example: Track purchase with order context
h2sTrack('purchase', {
  order_id: 'order_123',
  customer_email: 'customer@example.com',
  revenue: 150.00
});

// Example: Track job creation
h2sTrack('job_created', {
  job_id: 'job_456',
  order_id: 'order_123'
});

// The endpoint automatically:
// 1. Looks up the order/job in Supabase
// 2. Extracts customer info and revenue
// 3. Links the event to business entities
// 4. Creates attribution record for conversion
```

### Query Analytics in Supabase

```sql
-- Revenue by campaign
SELECT 
  utm_campaign,
  SUM(revenue_amount) as total_revenue,
  COUNT(*) as conversions
FROM h2s_tracking_events
WHERE event_type = 'purchase'
  AND revenue_amount IS NOT NULL
GROUP BY utm_campaign
ORDER BY total_revenue DESC;

-- Customer journey
SELECT 
  v.visitor_id,
  v.first_utm_campaign,
  COUNT(DISTINCT e.session_id) as sessions,
  COUNT(DISTINCT e.order_id) as orders,
  SUM(e.revenue_amount) as lifetime_value
FROM h2s_tracking_visitors v
LEFT JOIN h2s_tracking_events e ON e.visitor_id = v.visitor_id
WHERE e.order_id IS NOT NULL
GROUP BY v.visitor_id, v.first_utm_campaign;

-- Funnel attribution
SELECT 
  conversion_type,
  utm_campaign,
  COUNT(*) as conversions,
  SUM(conversion_value) as total_revenue
FROM h2s_tracking_funnel_attribution
WHERE converted_at >= NOW() - INTERVAL '30 days'
GROUP BY conversion_type, utm_campaign
ORDER BY total_revenue DESC;
```

## Next Steps

1. **Deploy updated schema**: Run `TRACKING_SCHEMA.sql` in Supabase SQL Editor
2. **Test tracking**: Use curl commands in `funnel-track.html` or visit pages with tracking
3. **Build analytics dashboard**: Query Supabase directly for metrics (dashboard in `funnel-track.html` needs rebuild)
4. **Monitor**: Check `h2s_tracking_events` table for incoming events

## Files Modified

- ✅ `api/track.js` - Enhanced with business entity linking
- ✅ `TRACKING_SCHEMA.sql` - Added business entity columns
- ✅ `public/funnel-track.html` - Removed Apps Script references
- ✅ `public/bundles.html` - Already using new endpoint (verified)

## No More Dual-Writes

All tracking data now flows **directly to Supabase**. No Sheets, no Apps Script, no dual-writes. Clean, fast, intelligent.

