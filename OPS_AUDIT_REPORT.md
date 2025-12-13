# Ops Audit Report: Messaging Sequencing + UX Reliability

**Date:** 2024  
**Scope:** SMS/Email sequencing, portal UX, edge cases  
**Status:** Audit Complete - Recommendations Only

---

## A) CURRENT SYSTEM MAP

### Messaging Triggers (SMS + Email)

#### 1. **Job Offer Sent** → Tech Notification
- **File:** `api/admin_send_offer.js` (line 142-163)
- **Trigger:** Admin manually sends offer OR auto-assignment creates offer
- **Event:** Assignment record created with `state='offered'`
- **Message Type:** SMS + Email (if pro has email)
- **Recipient:** Technician (pro)
- **Timing:** Immediate
- **Handler:** `api/notify-pro.js` (type: `new_job_assignment`)
- **Idempotency:** ✅ Check for existing offer (line 86-101) prevents duplicate offers
- **Failure Behavior:** ⚠️ Logs warning but doesn't retry (non-critical flag)

#### 2. **Job Accepted** → Customer Notification
- **File:** `api/portal_accept.js` (line 228-253)
- **Trigger:** Tech clicks "Accept" in portal
- **Event:** Assignment `state` updated to `'accepted'`, job `status` updated to `'accepted'`
- **Message Type:** Email only
- **Recipient:** Customer
- **Timing:** Immediate
- **Handler:** `api/send-pro-assigned-email.js`
- **Idempotency:** ✅ Double-accept protection (line 92-110) - blocks if another pro already accepted
- **Failure Behavior:** ⚠️ Logs warning, doesn't fail request (non-critical)

#### 3. **Job Declined** → Reassignment
- **File:** `api/portal_decline.js` (line 108-128)
- **Trigger:** Tech clicks "Decline" in portal
- **Event:** Assignment `state` updated to `'declined'`
- **Message Type:** ❌ **NONE** - No notification sent
- **Recipient:** N/A
- **Timing:** N/A
- **Handler:** N/A
- **Idempotency:** ✅ Retry with backoff (line 110-120)
- **Failure Behavior:** Returns error, no retry
- **Reassignment:** ❌ **NOT FOUND** - No automatic reassignment in Supabase API (only in Google Sheets `Operations.js`)

#### 4. **Job Rescheduled** → Customer Notification
- **File:** `api/reschedule-appointment.js` (line 86-140)
- **Trigger:** Admin/customer reschedules appointment
- **Event:** Order `delivery_date`/`delivery_time` updated, job `start_iso` updated
- **Message Type:** SMS + Email
- **Recipient:** Customer only
- **Timing:** Immediate
- **Handler:** `api/send-sms.js` + `api/send-email.js` (template: `appointment_rescheduled`)
- **Idempotency:** ❌ **NO** - No duplicate prevention
- **Failure Behavior:** Logs error, continues
- **Tech Notification:** ❌ **MISSING** - Assigned tech not notified of reschedule

#### 5. **Job Completed** → Customer Follow-up
- **File:** `api/portal_mark_done.js` (line 282-283)
- **Trigger:** Tech marks job complete (after photos + signature)
- **Event:** Assignment `state='completed'`, job `status='completed'`
- **Message Type:** ❌ **NOT FOUND** - Comment says "TODO: Trigger customer review email via Apps Script webhook"
- **Recipient:** N/A
- **Timing:** N/A
- **Handler:** Not implemented
- **Idempotency:** ✅ Retry with backoff for DB updates
- **Failure Behavior:** Returns error

#### 6. **Tech "On My Way"** → Customer Notification
- **File:** `api/portal_on_my_way.js` (line 106-136)
- **Trigger:** Tech clicks "On My Way" button
- **Event:** Job `status='en_route'`, `tech_en_route_at` timestamp set
- **Message Type:** SMS only (via Twilio direct)
- **Recipient:** Customer
- **Timing:** Immediate
- **Handler:** Direct Twilio API call (not via send-sms endpoint)
- **Idempotency:** ❌ **NO** - No duplicate check
- **Failure Behavior:** Logs error, doesn't fail request (non-critical)

#### 7. **24-Hour Reminder** → Customer
- **File:** `api/send-reminders.js` (cron job)
- **Trigger:** Vercel cron (daily at 10 AM EST)
- **Event:** Orders with `delivery_date` = tomorrow
- **Message Type:** SMS + Email
- **Recipient:** Customer
- **Timing:** Scheduled (24h before)
- **Handler:** `api/send-sms.js` + `api/send-email.js` (template: `appointment_reminder_24h`)
- **Idempotency:** ✅ Check `last_sms_type` prevents duplicates (line 29)
- **Failure Behavior:** Logs error, continues to next order

#### 8. **Day-Before Reminder** → Tech
- **File:** `api/notify-pro.js` (line 118-130)
- **Trigger:** ❌ **NOT FOUND** - Handler exists but no cron/trigger found
- **Event:** N/A
- **Message Type:** SMS + Email
- **Recipient:** Technician
- **Timing:** Should be day before job
- **Handler:** `api/notify-pro.js` (type: `day_before_reminder`)
- **Idempotency:** ❌ **NO**
- **Failure Behavior:** Returns error

#### 9. **Morning-of Reminder** → Tech
- **File:** `api/notify-pro.js` (line 132-144)
- **Trigger:** ❌ **NOT FOUND** - Handler exists but no cron/trigger found
- **Event:** N/A
- **Message Type:** SMS + Email
- **Recipient:** Technician
- **Timing:** Should be morning of job
- **Handler:** `api/notify-pro.js` (type: `morning_of_reminder`)
- **Idempotency:** ❌ **NO**
- **Failure Behavior:** Returns error

#### 10. **Two-Hour Reminder** → Tech
- **File:** `api/notify-pro.js` (line 146-158)
- **Trigger:** ❌ **NOT FOUND** - Handler exists but no cron/trigger found
- **Event:** N/A
- **Message Type:** SMS + Email
- **Recipient:** Technician
- **Timing:** Should be 2h before job
- **Handler:** `api/notify-pro.js` (type: `two_hour_reminder`)
- **Idempotency:** ❌ **NO**
- **Failure Behavior:** Returns error

### Portal File Flow

#### Portal Data Loading
- **File:** `api/portal_jobs.js`
- **Trigger:** Portal page load or manual refresh
- **Event:** GET request with session token
- **Data Source:** Supabase `h2s_dispatch_jobs` + `h2s_dispatch_job_assignments`
- **Caching:** ✅ Frontend caches in LocalStorage (`portalv3.html` line 17535-17586)
- **Stale Data Risk:** ⚠️ Cache can show stale offers if job was accepted/declined elsewhere
- **Concurrency:** ⚠️ No optimistic locking - two techs can see same offer simultaneously

---

## B) RISK & GAP LIST (Top 10)

### 1. **CRITICAL: No Tech Notification on Job Reschedule**
- **Where:** `api/reschedule-appointment.js` (line 142-154)
- **Edge Case:** Job rescheduled while tech is assigned
- **User Impact:** Tech shows up at wrong time, customer confused, wasted trip
- **Minimal Fix:** Add call to `notify-pro.js` with type `job_rescheduled` after job update (line 154)
- **Type:** Logic-only
- **Risk Level:** 🔴 HIGH

### 2. **CRITICAL: No Automatic Reassignment on Decline**
- **Where:** `api/portal_decline.js` (line 130)
- **Edge Case:** Tech declines, job stuck in `offer_sent` status
- **User Impact:** Job never gets reassigned, customer waits indefinitely
- **Minimal Fix:** After decline update, call reassignment logic (create `api/auto-reassign.js` or call existing cascade)
- **Type:** Logic-only
- **Risk Level:** 🔴 HIGH

### 3. **HIGH: No Customer Notification on Job Completion**
- **Where:** `api/portal_mark_done.js` (line 282-283)
- **Edge Case:** Job completed, customer never notified
- **User Impact:** Customer doesn't know work is done, may leave review request unread
- **Minimal Fix:** Add call to `notify-customer.js` with type `job_completed` or `send-email.js` with template `job_completed_thank_you`
- **Type:** Logic-only
- **Risk Level:** 🟡 MEDIUM-HIGH

### 4. **HIGH: No Tech Reminder Cron Jobs**
- **Where:** Missing cron jobs for `day_before_reminder`, `morning_of_reminder`, `two_hour_reminder`
- **Edge Case:** Tech forgets about job, no-show
- **User Impact:** Customer waits, job delayed, poor experience
- **Minimal Fix:** Create `api/cron/tech-reminders.js` that queries `h2s_dispatch_jobs` with `status='accepted'` and sends reminders based on `start_iso`
- **Type:** Logic-only (new file)
- **Risk Level:** 🟡 MEDIUM-HIGH

### 5. **MEDIUM: No Idempotency for SMS Sends**
- **Where:** `api/send-sms.js` (line 10-251)
- **Edge Case:** Webhook retry or duplicate API call sends same SMS twice
- **User Impact:** Customer receives duplicate messages, looks unprofessional
- **Minimal Fix:** Check `h2s_sms_log` for recent sent message (same `job_id` + `template_name` within last 5 minutes) before sending
- **Type:** Logic-only
- **Risk Level:** 🟡 MEDIUM

### 6. **MEDIUM: No Idempotency for "On My Way" SMS**
- **Where:** `api/portal_on_my_way.js` (line 106-136)
- **Edge Case:** Tech clicks "On My Way" twice, or API retries
- **User Impact:** Customer gets duplicate "on the way" messages
- **Minimal Fix:** Check if `tech_en_route_at` already set before sending SMS, or log to `h2s_sms_log` and check before sending
- **Type:** Logic-only
- **Risk Level:** 🟡 MEDIUM

### 7. **MEDIUM: Stale Portal Cache Shows Accepted Offers**
- **Where:** `public/portalv3.html` (line 17535-17586)
- **Edge Case:** Tech A accepts job, Tech B still sees offer in cached data
- **User Impact:** Tech B tries to accept, gets error, confusion
- **Minimal Fix:** Add `updated_at` timestamp check - if cached data is >30 seconds old, force refresh before showing offers
- **Type:** UI-only
- **Risk Level:** 🟡 MEDIUM

### 8. **MEDIUM: No Notification When Tech Declines**
- **Where:** `api/portal_decline.js` (line 130)
- **Edge Case:** Tech declines, dispatch doesn't know immediately
- **User Impact:** Dispatch manually checks, delay in reassignment
- **Minimal Fix:** Add call to `notify-management.js` or send SMS to dispatch phones when decline happens
- **Type:** Logic-only
- **Risk Level:** 🟡 MEDIUM

### 9. **LOW: No Reschedule Idempotency**
- **Where:** `api/reschedule-appointment.js` (line 86-140)
- **Edge Case:** Reschedule API called twice, customer gets duplicate notifications
- **User Impact:** Customer receives 2 SMS + 2 emails about same reschedule
- **Minimal Fix:** Check `h2s_orders.last_email_sent_at` and `last_email_type` - if `appointment_rescheduled` sent within last 2 minutes, skip
- **Type:** Logic-only
- **Risk Level:** 🟢 LOW

### 10. **LOW: Inconsistent Error Messages in Portal**
- **Where:** `public/portalv3.html` (multiple locations)
- **Edge Case:** Different error messages for same failure type
- **User Impact:** Confusing UX, harder to debug
- **Minimal Fix:** Standardize error messages - create `showError(code, context)` helper function
- **Type:** UI-only
- **Risk Level:** 🟢 LOW

---

## C) SAFE PATCHES (Minimal, Low-Risk)

### Patch 1: Add Tech Notification on Reschedule
**File:** `api/reschedule-appointment.js`  
**Location:** After line 154 (after job update)

```javascript
// Notify assigned tech if job exists and has accepted assignment
try {
  const { data: assignment } = await supabase
    .from('h2s_dispatch_job_assignments')
    .select('pro_id')
    .eq('job_id', job.job_id || '')
    .eq('state', 'accepted')
    .single();
  
  if (assignment?.pro_id) {
    const notifyEndpoint = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/notify-pro`
      : 'https://h2s-backend.vercel.app/api/notify-pro';
    
    await fetch(notifyEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: job.job_id,
        pro_id: assignment.pro_id,
        type: 'job_rescheduled',
        data: {
          old_date: oldDate,
          old_time: oldTime,
          new_date: delivery_date,
          new_time: delivery_time
        }
      })
    });
    console.log('[Reschedule] ✅ Tech notified');
  }
} catch (notifyErr) {
  console.warn('[Reschedule] Tech notification failed (non-critical):', notifyErr);
}
```

**Risk:** Low - wrapped in try/catch, non-blocking

---

### Patch 2: Add SMS Idempotency Check
**File:** `api/send-sms.js`  
**Location:** After line 42 (after validation, before opt-out check)

```javascript
// Idempotency: Check if same message sent recently
if (job_id && template) {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('h2s_sms_log')
    .select('id')
    .eq('phone', to)
    .eq('job_id', job_id)
    .eq('template_name', template)
    .eq('status', 'sent')
    .gte('sent_at', fiveMinutesAgo)
    .limit(1);
  
  if (recent && recent.length > 0) {
    console.log('[Send SMS] Duplicate detected, skipping');
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: 'Duplicate message prevented'
    });
  }
}
```

**Risk:** Low - only prevents duplicates, doesn't change behavior

---

### Patch 3: Add "On My Way" Idempotency
**File:** `api/portal_on_my_way.js`  
**Location:** Before line 106 (before SMS send)

```javascript
// Check if already sent (idempotency)
if (job.tech_en_route_at) {
  console.log('[portal_on_my_way] Already marked en_route, skipping SMS');
  return res.json({ 
    ok: true,
    message: 'Status already updated',
    already_sent: true
  });
}
```

**Risk:** Low - prevents duplicate sends, doesn't break flow

---

### Patch 4: Add Customer Notification on Completion
**File:** `api/portal_mark_done.js`  
**Location:** After line 281 (after payout creation, before return)

```javascript
// Send customer completion notification
try {
  const { data: jobData } = await supabase
    .from('h2s_dispatch_jobs')
    .select('customer_email, customer_phone, customer_name, order_id')
    .eq('job_id', jobId)
    .single();
  
  if (jobData?.customer_email) {
    const emailEndpoint = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}/api/send-email`
      : 'https://h2s-backend.vercel.app/api/send-email';
    
    await fetch(emailEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to_email: jobData.customer_email,
        template_key: 'job_completed_thank_you',
        data: {
          firstName: (jobData.customer_name || '').split(' ')[0] || 'there',
          reviewUrl: `https://home2smart.com/review?order=${jobData.order_id}`
        },
        order_id: jobData.order_id
      })
    });
    console.log('[MARK DONE] ✅ Customer notification sent');
  }
} catch (notifyErr) {
  console.warn('[MARK DONE] Customer notification failed (non-critical):', notifyErr);
}
```

**Risk:** Low - non-blocking, wrapped in try/catch

---

### Patch 5: Force Refresh Stale Offers
**File:** `public/portalv3.html`  
**Location:** In `loadJobs()` function, before rendering offers (around line 9325)

```javascript
// Check cache freshness for offers
const cachedJobs = getCache('dash');
if (cachedJobs && cachedJobs.offers) {
  const cacheAge = Date.now() - (cachedJobs.cached_at || 0);
  if (cacheAge > 30000) { // 30 seconds
    console.log('[Dashboard] Cache stale, forcing refresh');
    invalidateCache('dash');
    // Continue to API call below
  }
}
```

**Risk:** Low - only affects cache behavior, doesn't change API

---

## SUMMARY

**Total Gaps Found:** 10  
**Critical (🔴):** 2  
**High (🟡):** 3  
**Medium (🟡):** 4  
**Low (🟢):** 1  

**Safe Patches Provided:** 5  
**Architecture Changes Required:** 0  
**New Dependencies:** 0  

**Recommendation:** Implement Patches 1, 2, 3, and 4 immediately (all logic-only, low risk). Patch 5 (UI) can be done separately. The missing cron jobs for tech reminders require a new file but no structural changes.

