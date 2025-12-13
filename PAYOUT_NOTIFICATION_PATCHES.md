# Payout Approval Notification - Patches Summary

## Overview
Added tech notification when payout is approved in dispatch UI. Notification is sent via SMS (required) and email (optional) using existing messaging pipeline.

## Patches Applied

### 1. Server-Side Notification Logic
**File:** `api/admin_approve_payout.js`

**Changes:**
- Added `notifyTechPayoutApproved()` function that runs after successful approval
- Fetches pro details (name, phone, email) and job context
- Sends notification via `notify-pro` API endpoint
- Non-blocking: Approval succeeds even if notification fails

**Idempotency:**
- Checks `h2s_sms_log` for duplicate notifications within 24 hours
- Matches by: `job_id` + `pro_id` + `template_name='payout_approved'`
- Also checks message content for `payout_id` to prevent duplicates
- Returns `{ skipped: true }` if duplicate detected

**Notification Content:**
- Amount approved
- Job reference (service name or job ID)
- Message: "Payment is approved. You'll receive it per standard payout timing."

### 2. Notification Handler
**File:** `api/notify-pro.js`

**Changes:**
- Added `payout_approved` case to notification handler
- SMS message includes:
  - Pro name
  - Approved amount
  - Job reference
  - Portal link

### 3. UI Feedback & Loading State
**File:** `public/dispatch.html`

**Changes:**
- Added loading state to "Approve" button during request:
  - Button disabled
  - Opacity reduced
  - Text changes to "Approving..."
- Enhanced success toast to show notification status:
  - "✅ Payout approved successfully • Tech notified"
  - "✅ Payout approved successfully • Tech notification skipped (already sent)"
  - "✅ Payout approved successfully • Tech notify failed: [error]"
- Button re-enabled after request completes (success or error)

## Data Flow

1. **Dispatch clicks "Approve"** → `approvePayout(payoutId)` called
2. **Confirmation modal** → `updatePayoutStatus(payoutId, 'approve')` called
3. **API call** → `POST /api/admin_approve_payout` with `{ payout_id, action: 'approve' }`
4. **Backend updates** → `h2s_payouts_ledger.state = 'approved'`
5. **Notification triggered** → `notifyTechPayoutApproved(payout)` called
6. **Idempotency check** → Query `h2s_sms_log` for duplicates
7. **Pro lookup** → Fetch pro details from `h2s_dispatch_pros`
8. **Job lookup** → Fetch job context from `h2s_dispatch_jobs`
9. **Send notification** → Call `/api/notify-pro` with type `payout_approved`
10. **Response** → Return `{ ok: true, notification: { sent, skipped, error } }`
11. **UI updates** → Show toast with notification status, refresh payouts list

## Verification Steps

### Test 1: Approve payout once → tech receives 1 message
1. Open dispatch.html
2. Find a payout with `state='pending'`
3. Click "Approve"
4. Confirm approval succeeds
5. Check tech's phone for SMS: "Hi [Name]! ✅ PAYOUT APPROVED..."
6. Verify toast shows: "✅ Payout approved successfully • Tech notified"

### Test 2: Approve payout again / retry → no duplicate message
1. Same payout (or different payout for same job_id + pro_id)
2. Click "Approve" again (or retry API call)
3. Verify toast shows: "✅ Payout approved successfully • Tech notification skipped (already sent)"
4. Check `h2s_sms_log` table: Only 1 entry for this payout within 24h
5. Tech should NOT receive duplicate SMS

### Test 3: Messaging failure → approval still succeeds
1. Temporarily break `notify-pro` endpoint (or use invalid pro_id)
2. Click "Approve"
3. Verify approval succeeds (payout state = 'approved')
4. Verify toast shows: "✅ Payout approved successfully • Tech notify failed: [error]"
5. Payout should still be approved in database

## Database Tables Used

- `h2s_payouts_ledger`: Payout records (pro_id, job_id, amount, state)
- `h2s_dispatch_pros`: Pro details (name, phone, email)
- `h2s_dispatch_jobs`: Job context (service_name, customer_name)
- `h2s_sms_log`: Idempotency tracking (job_id, pro_id, template_name, sent_at)

## API Endpoints

- `POST /api/admin_approve_payout`: Approve/reject payout (updated)
- `POST /api/notify-pro`: Send tech notifications (updated)

## Error Handling

- **Pro not found**: Returns `{ skipped: true, error: 'Pro not found' }`
- **Missing data**: Returns `{ skipped: true, error: 'Missing pro_id or job_id' }`
- **Notification API failure**: Returns `{ sent: false, error: '[error message]' }`
- **All errors are non-blocking**: Approval always succeeds

## Notes

- Uses existing `notify-pro` pipeline (SMS + optional email)
- Uses `SUPABASE_SERVICE_ROLE_KEY` for notification queries (bypasses RLS)
- Notification is fire-and-forget (non-blocking)
- Idempotency window: 24 hours
- Duplicate detection: job_id + pro_id + template_name OR payout_id in message

