# SMS Consent Feature - Setup Guide

## What Was Added

### 1. **Bundles Page Updates** (`public/bundles.html`)
- ✅ Fixed broken functionality (cart, hamburger menu, all onclick handlers)
- ✅ Reverted `requestIdleCallback` wrapper that broke global function access
- ✅ Added optional SMS marketing consent checkbox in checkout form
- ✅ Checkbox clearly labeled as optional and separate from transactional messages
- ✅ Captures consent timestamp and stores in checkout metadata
- ✅ Sends consent to dedicated `/api/sms-consent` endpoint

### 2. **SMS Consent API** (`api/sms-consent.js`)
- ✅ POST endpoint to record SMS marketing consent
- ✅ TCPA compliance: stores who, when, where, and how customer consented
- ✅ Handles duplicate consents (updates existing record)
- ✅ Normalizes phone numbers for consistency
- ✅ Non-blocking: checkout continues even if consent recording fails

### 3. **Database Schema** (`sms_consents_table.sql`)
- ✅ Tracks consent per phone number + consent type
- ✅ Records timestamp, source, and customer details
- ✅ Supports opt-out tracking (for future STOP handling)
- ✅ Indexed for fast lookups

## Database Setup Required

**Run this SQL in Supabase SQL Editor:**

\`\`\`sql
-- Copy and paste the entire contents of sms_consents_table.sql
\`\`\`

Or navigate to Supabase Dashboard → SQL Editor → New Query → paste the SQL file contents.

## How It Works

### Customer Experience
1. Customer goes to checkout on bundles page
2. Sees required phone number field (for order updates)
3. Below phone field, sees **optional** checkbox:
   - "I agree to receive promotional text messages from Home2Smart..."
   - Clearly marked as optional and distinct from transactional messages
4. If checked, consent is recorded when they complete checkout

### Backend Flow
1. Checkout form captures `smsConsent` boolean
2. Adds to Stripe checkout metadata: `sms_marketing_consent: 'yes'/'no'`
3. **Separately** POSTs to `/api/sms-consent` with:
   - Customer name, email, phone
   - Timestamp of consent
   - Source: `'checkout_form'`
4. API stores in `sms_consents` table for compliance audit trail

### Compliance Benefits
- **Proof of consent**: Timestamp, source, exact wording shown to customer
- **Opt-out ready**: Table has `opted_out_at` field for future STOP handling
- **Separate from transactional**: Marketing consent is distinct from order updates
- **Auditable**: Query all consents by date, source, phone number

## Usage Examples

### Check if customer has consented to marketing
\`\`\`sql
SELECT * FROM sms_consents 
WHERE phone = '8645281475' 
AND consent_type = 'marketing' 
AND is_active = true;
\`\`\`

### Get all active marketing consents for SMS campaign
\`\`\`sql
SELECT name, email, phone_raw, consented_at 
FROM sms_consents 
WHERE is_active = true 
AND consent_type = 'marketing'
ORDER BY consented_at DESC;
\`\`\`

### Mark customer as opted out (when they text STOP)
\`\`\`sql
UPDATE sms_consents 
SET is_active = false,
    opted_out_at = NOW(),
    opt_out_method = 'STOP_SMS'
WHERE phone = '8645281475';
\`\`\`

## Testing

1. Go to https://home2smart.com/bundles
2. Add item to cart
3. Click checkout
4. Fill in form and **check** the SMS consent checkbox
5. Complete checkout
6. Verify in Supabase:
   \`\`\`sql
   SELECT * FROM sms_consents ORDER BY created_at DESC LIMIT 5;
   \`\`\`

## Performance Impact
- ✅ No blocking: consent recording is non-blocking
- ✅ Checkout still succeeds if SMS API fails
- ✅ Lightweight: single INSERT per consent
- ✅ Optimizations maintained: passive listeners, font loading, etc.

## Next Steps
1. Run SQL migration in Supabase
2. Test checkout flow with checkbox checked/unchecked
3. Verify data appears in `sms_consents` table
4. (Future) Build admin panel to view/export consents
5. (Future) Handle STOP messages from SMS provider webhook
