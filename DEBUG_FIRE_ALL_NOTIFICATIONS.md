# Debug Fire All Notifications - Implementation Summary

## Overview
Created a debug endpoint that fires all notification types in sequence, routing all messages to manager allowlists for safe testing.

## Files Modified

### 1. New Debug Endpoint
**File:** `api/debug_fire_all_notifications.js` (NEW)

**Features:**
- GET endpoint with secret key validation (`?key=...`)
- 10-minute cooldown (prevents spam)
- Manager allowlist routing (SMS + Email)
- Dry run mode (preview without sending)
- Optional `job_id` parameter (uses real data if provided)
- Optional `limit` parameter (fire only first N notifications)
- 250-500ms throttling between sends
- JSON report with status for each step

**Notification Sequence:**
1. new_job_assignment
2. job_accepted_confirmation
3. job_declined
4. appointment_rescheduled
5. on_my_way
6. appointment_reminder_24h
7. day_before_reminder
8. morning_of_reminder
9. two_hour_reminder
10. job_completed_thank_you
11. payout_approved

### 2. Recipient Override Support
**Files:** `api/send-sms.js`, `api/send-email.js`, `api/notify-pro.js`

**Changes:**
- Added `debug`, `force_to`, `force_email_to` parameters
- Only honored when `DEBUG_FIRE_KEY` env var is set
- SMS messages prefixed with `[TEST:<type>]`
- Email subjects prefixed with `[TEST:<type>]`
- Opt-out checks skipped in debug mode
- Idempotency checks skipped in debug mode

## Environment Variables Required

```bash
DEBUG_FIRE_KEY=your-secret-key-here
MANAGER_SMS_LIST=+18644502445,+18643239776
MANAGER_EMAIL_LIST=manager1@example.com,manager2@example.com
```

## Example curl Commands

### Dry Run (Preview Only)
```bash
curl "https://h2s-backend.vercel.app/api/debug_fire_all_notifications?key=your-secret-key&mode=dryrun"
```

### Live Mode (Actually Send)
```bash
curl "https://h2s-backend.vercel.app/api/debug_fire_all_notifications?key=your-secret-key&mode=live"
```

### With Real Job Data
```bash
curl "https://h2s-backend.vercel.app/api/debug_fire_all_notifications?key=your-secret-key&mode=dryrun&job_id=job_abc123"
```

### Limit to First 3 Notifications
```bash
curl "https://h2s-backend.vercel.app/api/debug_fire_all_notifications?key=your-secret-key&mode=dryrun&limit=3"
```

## Response Format

```json
{
  "ok": true,
  "mode": "dryrun",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "manager_allowlists": {
    "sms": ["+18644502445", "+18643239776"],
    "email": ["manager1@example.com", "manager2@example.com"]
  },
  "job_id": "job_abc123",
  "total_steps": 11,
  "results": [
    {
      "step": 1,
      "type": "new_job_assignment",
      "handler": "notify-pro",
      "status": "sent",
      "recipients": {
        "sms": ["+18644502445"],
        "email": ["manager1@example.com"]
      },
      "payload": { ... },
      "error": null
    },
    {
      "step": 2,
      "type": "job_accepted_confirmation",
      "handler": "notify-pro",
      "status": "skipped",
      "error": "Missing pro assignment or pro not found"
    }
  ]
}
```

## Safety Features

1. **Secret Key Required:** Endpoint only works with valid `DEBUG_FIRE_KEY`
2. **10-Minute Cooldown:** Prevents accidental spam (checks `h2s_sms_log`)
3. **Manager Allowlists Only:** All messages routed to managers, never real customers/techs
4. **Test Prefixes:** All messages clearly marked as `[TEST:<type>]`
5. **Dry Run Mode:** Preview payloads without sending
6. **Throttling:** 350ms delay between sends
7. **Non-Blocking:** Debug mode doesn't affect production logic

## Verification Steps

1. **Set Environment Variables:**
   ```bash
   DEBUG_FIRE_KEY=test-key-123
   MANAGER_SMS_LIST=+18644502445
   MANAGER_EMAIL_LIST=test@example.com
   ```

2. **Test Dry Run:**
   ```bash
   curl "https://h2s-backend.vercel.app/api/debug_fire_all_notifications?key=test-key-123&mode=dryrun"
   ```
   - Should return JSON with all steps in `dryrun` status
   - No actual messages sent

3. **Test Live Mode:**
   ```bash
   curl "https://h2s-backend.vercel.app/api/debug_fire_all_notifications?key=test-key-123&mode=live"
   ```
   - Should send messages to manager allowlists
   - All messages prefixed with `[TEST:...]`
   - Check manager phone/email for test messages

4. **Test Cooldown:**
   - Run live mode twice within 10 minutes
   - Second call should return `429` with "Cooldown active"

5. **Test Invalid Key:**
   ```bash
   curl "https://h2s-backend.vercel.app/api/debug_fire_all_notifications?key=wrong-key"
   ```
   - Should return `401` with "Unauthorized"

## Notes

- All notifications use existing messaging pipelines (`send-sms`, `send-email`, `notify-pro`)
- Recipient override only works when `DEBUG_FIRE_KEY` is set (production-safe)
- Debug mode skips opt-out checks and idempotency (for testing)
- Messages are logged to `h2s_sms_log` and `email_messages` tables
- Cooldown marker logged with `template_name='debug_fire_all'`

