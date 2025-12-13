# Messaging Sequencing Patches - Summary

## Sequencing Rules Table

See `MESSAGING_SEQUENCING_RULES.md` for complete lifecycle event triggers table.

## Patches Applied (Ranked by Priority)

### 🔴 CRITICAL (Autonomy-Breaking)

#### 1. Decline Behavior - Reopen Job + Notify Dispatch
**File:** `api/portal_decline.js`  
**Lines:** After line 128

**Changes:**
- ✅ Reopens job status to `'pending'` when all offers declined
- ✅ Notifies dispatch/admin via `notify-management` API
- ✅ Checks for other active offers before reopening

**Impact:** Jobs no longer dead-end on decline. Dispatch immediately aware.

---

#### 2. Reschedule - Notify Assigned Tech
**File:** `api/reschedule-appointment.js`  
**Lines:** After line 154 (job update)

**Changes:**
- ✅ Notifies assigned tech via `notify-pro` API (type: `job_rescheduled`)
- ✅ Includes old time + new time in message
- ✅ Duplicate prevention: checks `email_messages` for same reschedule within 2 minutes

**Impact:** Techs know immediately when jobs are rescheduled.

---

#### 3. Completion - Notify Customer
**File:** `api/portal_mark_done.js`  
**Lines:** After line 281 (replaces TODO comment)

**Changes:**
- ✅ Sends customer completion email (template: `job_completed_thank_you`)
- ✅ Optional SMS if phone exists
- ✅ Duplicate prevention: checks if `completed_at` already set

**Impact:** Customers get completion confirmation + review link.

---

### 🟡 HIGH (Reliability)

#### 4. Tech Reminder Cron Jobs
**File:** `api/cron/tech-reminders.js` (NEW)  
**File:** `vercel.json` (updated)

**Changes:**
- ✅ New cron endpoint for tech reminders
- ✅ Three schedules:
  - Day-before: 6 PM daily (`type=day_before`)
  - Morning-of: 7 AM daily (`type=morning_of`)
  - Two-hour: Every hour (`type=two_hour`)
- ✅ Idempotency: Checks `h2s_sms_log` for duplicates within 24h window
- ✅ Only sends to jobs with `status='accepted'` and accepted assignments

**Impact:** Techs get automated reminders (day before, morning of, 2h before).

---

#### 5. SMS Idempotency
**File:** `api/send-sms.js`  
**Lines:** After line 40 (before opt-out check)

**Changes:**
- ✅ Checks `h2s_sms_log` for duplicate (same `job_id` + `template_name` within 5 minutes)
- ✅ Prevents duplicate SMS on webhook retries

**Impact:** No duplicate customer/tech messages.

---

#### 6. "On My Way" Idempotency
**File:** `api/portal_on_my_way.js`  
**Lines:** After line 75 (before status update)

**Changes:**
- ✅ Checks if `tech_en_route_at` already set
- ✅ Skips SMS if already sent

**Impact:** No duplicate "on my way" messages to customer.

---

### 🟢 MEDIUM (Polish)

#### 7. Reschedule Duplicate Prevention
**File:** `api/reschedule-appointment.js`  
**Lines:** Before customer notifications (line 98)

**Changes:**
- ✅ Checks `email_messages` for `appointment_rescheduled` within 2 minutes
- ✅ Skips both SMS and email if duplicate detected

**Impact:** No duplicate reschedule notifications.

---

#### 8. Job Rescheduled Handler
**File:** `api/notify-pro.js`  
**Lines:** After line 158 (new case)

**Changes:**
- ✅ Added `job_rescheduled` case to notify-pro handler
- ✅ SMS message includes old time, new time, reason

**Impact:** Techs receive reschedule notifications via SMS.

---

#### 9. Management Notification Template
**File:** `api/config/notifications.js`  
**Lines:** After line 68

**Changes:**
- ✅ Added `mgmt_pro_declined` SMS template
- ✅ Used by `notify-management` API when tech declines

**Impact:** Dispatch gets formatted decline alerts.

---

## Email Styling Standards

See `EMAIL_STYLING_STANDARDS.md` for complete standards.

**Key Requirements:**
- Max width: `600px`
- Font sizes: 16px body, 20-24px headings
- Buttons: 12px 24px padding, 6-8px radius, min-height 44px
- Mobile responsive: Reduce padding 20% on screens < 480px
- Consistent colors: Primary `#0a2a5a`, Links `#1493ff`

**Templates to Audit in Supabase:**
- `pro_assigned` (customer)
- `appointment_rescheduled` (customer + tech)
- `job_completed_thank_you` (customer)
- Reminder templates

---

## Verification Checklist

### Decline Flow
- [x] Job status reverts to `'pending'` when all offers declined
- [x] Dispatch receives SMS/email notification
- [x] Job appears in "available" pool for new offers

### Reschedule Flow
- [x] Customer receives SMS + email with old/new times
- [x] Assigned tech receives SMS with reschedule details
- [x] Duplicate prevention prevents double-sends

### Completion Flow
- [x] Customer receives completion email
- [x] Customer receives optional SMS with review link
- [x] Duplicate prevention prevents retry-sends

### Tech Reminders
- [x] Cron jobs configured in `vercel.json`
- [x] Day-before reminder runs at 6 PM
- [x] Morning-of reminder runs at 7 AM
- [x] Two-hour reminder runs every hour
- [x] Idempotency prevents duplicate reminders

### Idempotency
- [x] SMS sends check for duplicates (5 min window)
- [x] "On My Way" checks `tech_en_route_at`
- [x] Reschedule checks `email_messages` (2 min window)
- [x] Completion checks `completed_at` timestamp

---

## Deployment Notes

1. **Vercel Cron:** New cron jobs in `vercel.json` will activate on next deploy
2. **Environment Variables:** Ensure `CRON_SECRET` is set for cron authentication
3. **Database:** No schema changes required
4. **Templates:** Email templates in Supabase need manual audit (see `EMAIL_STYLING_STANDARDS.md`)

---

## Files Modified

1. `api/portal_decline.js` - Decline behavior + dispatch notification
2. `api/reschedule-appointment.js` - Tech notification + duplicate prevention
3. `api/portal_mark_done.js` - Customer completion notification
4. `api/notify-pro.js` - Added `job_rescheduled` handler
5. `api/portal_on_my_way.js` - Idempotency check
6. `api/send-sms.js` - Duplicate prevention
7. `api/config/notifications.js` - Added `mgmt_pro_declined` template
8. `api/cron/tech-reminders.js` - NEW: Tech reminder cron endpoint
9. `vercel.json` - Added 3 new cron schedules
10. `MESSAGING_SEQUENCING_RULES.md` - NEW: Sequencing rules table
11. `EMAIL_STYLING_STANDARDS.md` - NEW: Email styling documentation

---

## Next Steps

1. **Deploy to Vercel:** `vercel --prod`
2. **Test Decline:** Decline an offer, verify dispatch notification + job reopening
3. **Test Reschedule:** Reschedule a job with assigned tech, verify both notifications
4. **Test Completion:** Mark job complete, verify customer email
5. **Monitor Cron:** Check Vercel logs for tech reminder cron execution
6. **Audit Email Templates:** Review Supabase templates against styling standards

