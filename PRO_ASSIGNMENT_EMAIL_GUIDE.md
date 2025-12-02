# PRO ASSIGNMENT EMAIL FLOW

## OVERVIEW
When a pro accepts a job (or admin manually assigns), customers now receive a **personalized email** with:
- ✅ Pro's profile photo
- ✅ Pro's name
- ✅ Company brand message (generic, applies to all pros)
- ✅ Job details (date, time, address)
- ✅ Next steps and reschedule link

**NOTE:** Individual pro ratings/reviews are NOT shown. All pros represent the same brand standard.

---

## DATABASE SCHEMA

### h2s_dispatch_pros
Pro profiles contain:
```sql
- photo_url TEXT  -- Pro's profile photo
- name TEXT       -- Pro's display name
```

**REMOVED (not used):**
- ~~bio_short~~ - Using generic brand message instead
- ~~avg_rating~~ - Not collecting individual pro reviews yet
- ~~reviews_count~~ - Future enhancement

### h2s_email_templates
New template added:
```sql
template_key: 'pro_assigned'
category: 'transactional'
subject: '👍 Your Pro is Confirmed - {pro_name} is on the way!'
```

---

## NEW FILES CREATED

### 1. `ADD_PRO_ASSIGNED_EMAIL_TEMPLATE.sql`
- Creates email template with pro card design
- Includes responsive HTML with profile photo
- Styled with gradient header and pro bio section

**TO DEPLOY:**
```bash
# Run in Supabase SQL Editor
# Copy contents of ADD_PRO_ASSIGNED_EMAIL_TEMPLATE.sql
```

### 2. `api/send-pro-assigned-email.js`
- Endpoint: `POST /api/send-pro-assigned-email`
- Fetches job + pro details from database
- Formats date/time for email
- Sends email via `send-email` endpoint
- Also triggers SMS via `notify-customer`

**USAGE:**
```javascript
fetch('/api/send-pro-assigned-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    job_id: 'uuid-here',
    pro_id: 'uuid-here'
  })
})
```

---

## FILES MODIFIED

### 1. `api/portal_accept.js`
**ADDED:** Email trigger when pro accepts job

```javascript
// After job status update to 'accepted'
const emailResponse = await fetch('/api/send-pro-assigned-email', {
  method: 'POST',
  body: JSON.stringify({ job_id: jobId, pro_id: proId })
});
```

**TRIGGER POINT:** When pro clicks "Accept" button in portal

### 2. `api/admin_send_offer.js`
**ADDED:** 
1. SMS notification to pro when offer sent
2. Email to customer if admin auto-assigns (state='accepted')

```javascript
// Send SMS to pro
await fetch('/api/notify-pro', {
  type: 'new_job_assignment'
});

// If auto-accepted, email customer
if (newOffer.state === 'accepted') {
  await fetch('/api/send-pro-assigned-email', {
    job_id, pro_id
  });
}
```

**TRIGGER POINT:** When admin manually assigns job in dispatch portal

---

## EMAIL TEMPLATE DATA

### Variables passed to template:
```javascript
{
  customer_name: "John Smith",
  pro_name: "Mike Johnson",
  pro_photo_url: "https://...",
  service_name: "HVAC Maintenance",
  date: "Wednesday, December 4, 2024",
  time_window: "2:00 PM - 4:00 PM",
  service_address: "123 Main St, Greenville, SC 29601",
  job_id: "uuid-for-reschedule-link"
}
```

**NOTE:** No individual ratings/bios - using generic brand message for all pros.

### Email features:
- **Responsive design** (mobile-friendly)
- **Pro card** with circular photo, name, and brand message
- **Generic brand slogan** applies to all pros (no individual ratings)
- **Appointment box** with date/time/address
- **Reschedule link** (home2smart.com/reschedule?job={job_id})
- **Next steps** checklist (24hr reminder, on-the-way text, updates)

---

## DEPLOYMENT CHECKLIST

### Step 1: Deploy SQL Template
```bash
# 1. Go to Supabase SQL Editor
# 2. Copy ADD_PRO_ASSIGNED_EMAIL_TEMPLATE.sql
# 3. Run query
# 4. Verify: SELECT * FROM h2s_email_templates WHERE template_key = 'pro_assigned';
```

### Step 2: Deploy API Changes
```bash
cd h2s-backend
vercel --prod
```

**Files deployed:**
- ✅ `api/send-pro-assigned-email.js` (new endpoint)
- ✅ `api/portal_accept.js` (email trigger added)
- ✅ `api/admin_send_offer.js` (SMS + email triggers added)

### Step 3: Test Flow
```bash
# Test 1: Pro accepts job in portal
# Expected: Customer receives email with pro photo/bio

# Test 2: Admin manually assigns job
# Expected: Pro receives SMS, customer receives email (if auto-accepted)
```

---

## VALIDATION QUERIES

### Check if email template exists:
```sql
SELECT 
  template_key,
  category,
  subject,
  is_active
FROM h2s_email_templates
WHERE template_key = 'pro_assigned';
```
### Check if pros have photos:
```sql
SELECT 
  pro_id,
  name,
  photo_url IS NOT NULL as has_photo,
  status
FROM h2s_dispatch_pros
WHERE status = 'active'
LIMIT 10;
```IT 10;
```

### Check email logs:
```sql
SELECT 
  id,
  to_email,
  subject,
  status,
  message_type,
  sent_at,
  created_at
FROM email_messages
WHERE message_type = 'pro_assigned'
ORDER BY created_at DESC
LIMIT 20;
```

---

## FLOW DIAGRAM

```
┌─────────────────────┐
│ Customer Books Job  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────┐
│ Job Created (status=pending)│
└──────────┬──────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Pro Accepts Job in Portal        │ ◄── portal_accept.js
│  OR                               │
│ Admin Manually Assigns           │ ◄── admin_send_offer.js
└──────────┬───────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ Job Status → 'accepted'             │
│ Assignment Record → state='accepted'│
└──────────┬──────────────────────────┘
           │
           ├──────────────┬─────────────┐
           ▼              ▼             ▼
    ┌──────────┐   ┌──────────┐  ┌──────────┐
    │ SMS to   │   │ SMS to   │  │ EMAIL to │
    │ Pro      │   │ Customer │  │ Customer │
    │ (confirm)│   │ (assigned)│ │ (w/photo)│
    └──────────┘   └──────────┘  └──────────┘
         ↑              ↑              ↑
    notify-pro    notify-customer  send-pro-
         .js           .js         assigned-email.js
```

---

## FALLBACK HANDLING

### If pro has no photo:
```javascript
### If pro has no photo:
```javascript
pro_photo_url: pro.photo_url || 'https://via.placeholder.com/120'
```

**Brand message is hardcoded:**
"Experienced, certified, and committed to quality work - that's the Home2Smart standard."

## NEXT STEPS (OPTIONAL)

### Enhance Pro Profiles
1. **Add more pros:** Ensure all active pros have:
   - Profile photo uploaded
   - Bio written (2-3 sentences)
   - Ratings calculated from reviews

2. **Pro portal upgrade:** Let pros edit their own bio/photo
   - Add `/api/portal_update_profile` endpoint
   - Add profile editor in portal UI

### Enhance Pro Profiles
1. **Add pro photos:** Ensure all active pros have profile photos uploaded
2. **Future:** Individual pro reviews (h2s_dispatch_reviews table exists but not used yet)
3. **Future:** Pro-specific bios and ratings (can enable later)
WHERE message_type = 'pro_assigned'
  AND sent_at IS NOT NULL;
```

---

## TROUBLESHOOTING

### Email not sending?
1. Check SendGrid API key: `echo $SENDGRID_API_KEY`
2. Check template exists: `SELECT * FROM h2s_email_templates WHERE template_key = 'pro_assigned';`
3. Check email logs: `SELECT * FROM email_messages WHERE message_type = 'pro_assigned' ORDER BY created_at DESC LIMIT 5;`

### Pro photo not showing?
1. Verify photo URL in database: `SELECT name, photo_url FROM h2s_dispatch_pros WHERE pro_id = 'xxx';`
2. Check if URL is publicly accessible (not behind auth)
3. Fallback placeholder will show if photo_url is NULL

### Rating not accurate?
Update pro ratings from reviews:
```sql
UPDATE h2s_dispatch_pros p
SET 
  avg_rating = (
    SELECT AVG(stars_tech) 
    FROM h2s_dispatch_reviews 
### Pro photo not showing?
1. Verify photo URL in database: `SELECT name, photo_url FROM h2s_dispatch_pros WHERE pro_id = 'xxx';`
2. Check if URL is publicly accessible (not behind auth)
3. Fallback placeholder will show if photo_url is NULL

### Want individual pro reviews later?
The `h2s_dispatch_reviews` table exists and is ready. When you want to collect pro-specific reviews:
1. Build review collection page (link customers after job completion)
2. Auto-calculate pro ratings from reviews
3. Update email template to show individual ratings instead of generic brand message Email template with pro card design
- ✅ Auto-trigger when pro accepts job
- ✅ Auto-trigger when admin assigns job
- ✅ Integrated with existing SMS flow

**READY FOR:**
- 🚀 Deploy to production
- 📊 Track email opens (SendGrid analytics)
- 👥 Add more pro profiles
- 🎨 Customize email design if needed
**PROBLEM SOLVED:**
- ✅ Customer knows WHO is coming (name + face)
- ✅ Builds trust with brand message (all pros = same quality)
- ✅ Reduces "who's this?" texts/calls
- ✅ Simple - no individual review management needed