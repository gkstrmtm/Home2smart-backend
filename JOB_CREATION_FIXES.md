# Job Creation Flow Fixes - Summary

## Issues Identified & Fixed

### 1. **Address Metadata Not Extracted for Job Creation** ❌ → ✅

**Problem:**
- Stripe webhook stores address in `metadata` JSON column: `service_address`, `service_city`, `service_state`, `service_zip`
- Job creation code expected address in top-level columns: `order.service_address`, etc.
- Result: Jobs created with null addresses, geocoding failed, no lat/lng coordinates

**Root Cause:**
- `h2s_orders` table schema has no top-level address columns
- Webhook stores `metadata: session.metadata` (JSON blob)
- Job creation read `order.service_address` which doesn't exist

**Solution:**
- Updated `api/create_jobs_from_orders.js` lines 230-250
- Extract metadata from `order.metadata` or `order.metadata_json`
- Read address fields from metadata first, fallback to top-level columns for backward compatibility

**Code Change:**
```javascript
// Extract metadata (contains service_address, service_city, service_state, service_zip from checkout)
let orderMetadata = {};
try {
  if (order.metadata && typeof order.metadata === 'object') {
    orderMetadata = order.metadata;
  } else if (order.metadata_json && typeof order.metadata_json === 'string') {
    orderMetadata = JSON.parse(order.metadata_json);
  } else if (order.metadata_json && typeof order.metadata_json === 'object') {
    orderMetadata = order.metadata_json;
  }
} catch (e) {
  console.warn('[create_jobs] Could not parse order metadata:', e.message);
}

// Support both metadata fields and legacy top-level columns
const address = orderMetadata.service_address || order.service_address || order.address || null;
const city = orderMetadata.service_city || order.service_city || order.city || null;
const state = orderMetadata.service_state || order.service_state || order.state || null;
const zip = orderMetadata.service_zip || order.service_zip || order.zip || null;
```

---

### 2. **Payout Calculation Uses Discounted Total (Unfair to Pros)** ❌ → ✅

**Problem:**
- Pros get paid 60% of `order.total` (final amount after discounts)
- When customers use 20% off promo: $599 → $479.20 → Pro gets $287.52 instead of $359.40
- When customers use 50% off promo: $599 → $299.50 → Pro gets $179.70 instead of $359.40
- Promos reduce pro earnings unfairly (they do same work regardless of customer discount)

**Root Cause:**
- Webhook stores only `total: session.amount_total / 100` (discounted amount)
- Payout calculated as `orderTotal * 0.60`
- No subtotal column to reference pre-discount amount

**Solution:**
1. **Schema Migration:** Add `subtotal` column to `h2s_orders` table
2. **Webhook Update:** Store both `subtotal` (pre-discount) and `total` (post-discount)
3. **Payout Logic:** Calculate from `order.subtotal` instead of `order.total`

**Files Changed:**

**`ADD_SUBTOTAL_TO_ORDERS.sql`** (new file):
```sql
ALTER TABLE public.h2s_orders 
ADD COLUMN IF NOT EXISTS subtotal numeric;

COMMENT ON COLUMN public.h2s_orders.subtotal IS 'Pre-discount amount used for calculating pro payouts (60% of subtotal, not discounted total)';
```

**`api/stripe-webhook.js`** (line 87):
```javascript
// OLD:
total: session.amount_total / 100,

// NEW:
subtotal: (session.amount_subtotal || session.amount_total) / 100, // Pre-discount
total: session.amount_total / 100, // Post-discount
```

**`api/create_jobs_from_orders.js`** (lines 295-345):
```javascript
// OLD:
const orderTotal = parseFloat(order.total || 0);
let basePayout = Math.floor(orderTotal * 0.60);
estimatedPayout = Math.max(MIN_PAYOUT, basePayout);
if (orderTotal > 0) {
  estimatedPayout = Math.min(estimatedPayout, orderTotal * MAX_PAYOUT_PCT);
}

// NEW:
const orderSubtotal = parseFloat(order.subtotal || order.total || 0);
const orderTotal = parseFloat(order.total || 0);
console.log(`[create_jobs] Order financials - Subtotal: $${orderSubtotal}, Total: $${orderTotal}`);

let basePayout = Math.floor(orderSubtotal * 0.60); // Use subtotal!
estimatedPayout = Math.max(MIN_PAYOUT, basePayout);
if (orderSubtotal > 0) {
  estimatedPayout = Math.min(estimatedPayout, orderSubtotal * MAX_PAYOUT_PCT); // Cap at 80% of subtotal
}
```

**Payout Examples:**
| Subtotal | Promo | Total Paid | Old Payout | New Payout | Difference |
|----------|-------|------------|------------|------------|------------|
| $599     | 0%    | $599       | $359.40    | $359.40    | $0         |
| $599     | 20%   | $479.20    | $287.52    | $359.40    | **+$71.88** |
| $599     | 50%   | $299.50    | $179.70    | $359.40    | **+$179.70** |

---

## Deployment Checklist

### 1. Database Migration
```bash
# Connect to Supabase SQL editor
# Run: ADD_SUBTOTAL_TO_ORDERS.sql
```

### 2. Backend Deployment
```bash
cd h2s-backend
git add api/stripe-webhook.js api/create_jobs_from_orders.js
git commit -m "Fix metadata extraction and payout calculation

- Extract service address from order.metadata (was expecting top-level columns)
- Calculate payout from subtotal (pre-discount) instead of total
- Add subtotal column to webhook order creation
- Ensures pros get fair 60% of original price regardless of customer promos"

git push origin main
# Vercel auto-deploys
```

### 3. Verification Steps

**Test Address Extraction:**
```bash
# After next checkout, query Supabase:
SELECT 
  order_id, 
  metadata->>'service_address' as address,
  metadata->>'service_city' as city,
  metadata->>'service_state' as state,
  metadata->>'service_zip' as zip
FROM h2s_orders 
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC 
LIMIT 1;
```

**Test Payout Calculation:**
```bash
# Trigger job creation with test order:
curl -X POST "https://h2s-backend.vercel.app/api/create_jobs_from_orders?limit=1"

# Check logs for:
# [create_jobs] Order financials - Subtotal: $599, Total: $479.20
# [create_jobs] Payout Calculated: $359.40 (Order: $479.20)
```

**Test Complete Flow:**
1. Go to bundles page: https://home2smart.com/bundles
2. Add item to cart (e.g., Basic Camera Install - $599)
3. Apply 20% off promo code
4. Enter address using autocomplete
5. Complete checkout
6. Verify in Supabase:
   - `h2s_orders` has `subtotal: 599`, `total: 479.20`, `metadata` with address
   - `h2s_dispatch_jobs` has `service_address`, `geo_lat`, `geo_lng`, `payout_amount: 359.40`

---

## Files Modified

### New Files:
- `ADD_SUBTOTAL_TO_ORDERS.sql` - Schema migration for subtotal column
- `test-job-creation-flow.js` - Automated verification tests

### Modified Files:
- `api/stripe-webhook.js` - Store subtotal and total separately
- `api/create_jobs_from_orders.js` - Extract metadata, calculate payout from subtotal

---

## Technical Details

### Address Data Flow:
```
Frontend (bundles.html)
  ↓ Stripe checkout metadata
{
  service_address: "123 Main St",
  service_city: "Greenville", 
  service_state: "SC",
  service_zip: "29601"
}
  ↓ Webhook (stripe-webhook.js)
h2s_orders table:
  metadata: { service_address: "...", ... } ← JSON column
  ↓ Job Creation (create_jobs_from_orders.js)
const orderMetadata = order.metadata || JSON.parse(order.metadata_json);
const address = orderMetadata.service_address;
  ↓ Geocoding (Google Maps API)
const { lat, lng } = await geocodeAddress(address, city, state, zip);
  ↓ Job Saved
h2s_dispatch_jobs table:
  service_address: "123 Main St",
  geo_lat: 34.8526,
  geo_lng: -82.3940
```

### Payout Calculation Flow:
```
Stripe Checkout Session
  ↓ amount_subtotal: 59900 (cents)
  ↓ amount_total: 47920 (cents, after 20% promo)
Webhook (stripe-webhook.js)
  ↓ subtotal: 599 (dollars)
  ↓ total: 479.20 (dollars)
h2s_orders table
  ↓ order.subtotal: 599
  ↓ order.total: 479.20
Job Creation (create_jobs_from_orders.js)
  ↓ basePayout = subtotal * 0.60 = 359.40
  ↓ estimatedPayout = max(35, min(359.40, subtotal * 0.80))
h2s_dispatch_jobs table
  ↓ payout_amount: 359.40
h2s_payouts_ledger (when job completed)
  ↓ Pro gets $359.40 (fair 60% of original $599)
  ↓ Business keeps $119.80 ($479.20 - $359.40)
  ↓ Promo cost absorbed by business, not pro
```

---

## Testing Results

✅ **Address Metadata Extraction** - Verified in code  
✅ **Payout Calculation Logic** - Verified in code  
✅ **Schema Migration** - SQL file created  
⏳ **Live Checkout Test** - Pending deployment  
⏳ **Job Creation End-to-End** - Pending deployment  

---

## Notes

- **Backward Compatibility:** Code falls back to top-level columns if metadata doesn't exist
- **Subtotal Fallback:** Uses `order.total` if `order.subtotal` is null (for old orders)
- **Geocoding:** Requires valid address; logs warning if geocoding fails but still creates job
- **Business Impact:** Promos now cost business margin, not pro payouts (industry standard)
