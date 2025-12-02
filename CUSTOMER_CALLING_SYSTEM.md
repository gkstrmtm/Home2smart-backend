# 📞 CUSTOMER CALLING SYSTEM - PORTAL INTEGRATION

## 🎯 OBJECTIVE
Enable pros to call customers directly from the portal for:
1. **Upcoming Appointments** - Pre-visit coordination
2. **Quote Requests** - Custom consultations
3. **Lead Follow-ups** - Convert inquiries to bookings

---

## 📋 REQUIREMENTS

### Use Cases:
1. **Pre-Appointment Calls**
   - Pro sees appointment tomorrow → calls to confirm
   - Customer needs prep instructions (wall access, TV unboxed, etc.)
   - Coordinate exact arrival time

2. **Consultation Calls**
   - Custom quote requests from contact form
   - Complex installations needing assessment
   - Customer has questions before booking

3. **Lead Nurturing**
   - Follow up on abandoned carts
   - Reach out to nearby customers (geo-targeted)
   - Re-engage past customers for new services

---

## 🏗️ ARCHITECTURE

### Database Tables (Already Exist):
- `h2s_orders` - Customer appointments with phone/address
- `h2s_dispatch_jobs` - Job assignments to pros
- `h2s_users` - Customer profiles (phone, address, history)

### New Components Needed:

#### 1. API Endpoint: `/api/portal_customers`
**Purpose:** Fetch customers for pro to call

**Query Logic:**
```sql
-- Upcoming appointments assigned to pro
SELECT DISTINCT
  o.customer_name,
  o.customer_phone,
  o.customer_email,
  o.service_address,
  o.delivery_date,
  o.delivery_time,
  o.service_name,
  o.amount_total,
  'appointment' as call_reason,
  o.order_id
FROM h2s_orders o
JOIN h2s_dispatch_jobs j ON o.order_id = j.order_id
JOIN h2s_dispatch_job_assignments a ON j.job_id = a.job_id
WHERE a.pro_id = $pro_id
  AND a.state = 'accepted'
  AND o.delivery_date >= CURRENT_DATE
  AND o.delivery_date <= CURRENT_DATE + INTERVAL '7 days'
ORDER BY o.delivery_date, o.delivery_time;

-- Quote requests (from contact form / lead gen)
-- TODO: Add h2s_leads table for consultation requests

-- Nearby leads (geo-targeted)
-- TODO: Match pro's service area with customer zip codes
```

#### 2. Portal UI: "Customers" Tab
**Location:** `portalv3.html` - Add new view

**Features:**
- **List View:** Cards showing customer name, phone, reason for call, context
- **Click-to-Call:** `tel:` links on mobile, Twilio integration on desktop
- **Call Notes:** Text area to log call outcome
- **Quick Actions:** 
  - "Mark as Contacted"
  - "Schedule Follow-up"
  - "Create Quote" (future)

**UI Mockup:**
```
┌─────────────────────────────────────────────┐
│ 📞 CUSTOMERS TO CALL                        │
├─────────────────────────────────────────────┤
│ 🔵 UPCOMING APPOINTMENTS (3)                │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ John Smith                   📞 864-555-0100│ │
│ │ TV Mount - Tomorrow @ 2:00 PM           │ │
│ │ 123 Oak St, Greenville SC               │ │
│ │                                         │ │
│ │ [📞 Call Now] [✓ Mark Contacted]        │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ 🟡 QUOTE REQUESTS (1)                       │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Sarah Johnson            📞 864-555-0200│ │
│ │ Custom Security System Quote            │ │
│ │ Requested: 2 days ago                   │ │
│ │                                         │ │
│ │ [📞 Call Now] [Create Quote]            │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

#### 3. Call Logging System
**Table:** `h2s_call_logs` (NEW)

```sql
CREATE TABLE h2s_call_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pro_id TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  order_id TEXT,
  call_reason TEXT, -- 'appointment', 'quote', 'lead'
  call_outcome TEXT, -- 'completed', 'no_answer', 'voicemail', 'rescheduled'
  notes TEXT,
  called_at TIMESTAMPTZ DEFAULT NOW(),
  follow_up_date TIMESTAMPTZ
);

CREATE INDEX idx_call_logs_pro ON h2s_call_logs(pro_id);
CREATE INDEX idx_call_logs_order ON h2s_call_logs(order_id);
```

---

## 🚀 IMPLEMENTATION PLAN

### Phase 1: Basic Customer List (30 min)
1. ✅ Create `/api/portal_customers` endpoint
2. ✅ Query `h2s_orders` joined with `h2s_dispatch_job_assignments`
3. ✅ Filter by pro_id + upcoming dates
4. ✅ Return customer name, phone, address, appointment details

### Phase 2: Portal UI (45 min)
1. ✅ Add "Customers" tab to `portalv3.html`
2. ✅ Create customer card component (name, phone, context, call button)
3. ✅ Click-to-call: `<a href="tel:8645550100">📞 Call Now</a>`
4. ✅ Section headers: "Upcoming Appointments", "Quote Requests", "Leads"

### Phase 3: Call Logging (30 min)
1. ✅ Create `h2s_call_logs` table in Supabase
2. ✅ API endpoint: `/api/portal_log_call`
3. ✅ Portal UI: "Mark as Contacted" button → opens notes modal
4. ✅ Save: call_outcome, notes, follow_up_date

### Phase 4: Quote Requests (FUTURE - Complex)
1. ⏳ Create `h2s_leads` table (contact form submissions)
2. ⏳ Add "Create Quote" flow (pricing builder UI)
3. ⏳ Generate checkout link for custom quote
4. ⏳ Email quote link to customer

---

## 💡 QUICK WIN: Phases 1-3 (Under 2 hours)

**What Pros Get:**
- See all upcoming appointments with customer phone numbers
- Click to call customers directly (mobile: opens phone app)
- Log call notes and outcomes
- Track which customers have been contacted

**What's Deferred:**
- Custom quote generation (needs pricing structure)
- Lead nurturing system (needs h2s_leads table)
- Twilio integration for desktop calling (can use mobile for now)

---

## 🔧 TECHNICAL NOTES

### Click-to-Call Implementation:
```html
<!-- Mobile: Opens phone dialer -->
<a href="tel:+18645550100" class="btn">📞 Call Now</a>

<!-- Desktop: Future Twilio integration -->
<!-- <button onclick="initiateCall('+18645550100')">📞 Call via Browser</button> -->
```

### Data Flow:
```
Portal → /api/portal_customers?pro_id=abc123
       ← Returns: [{
           customer_name: "John Smith",
           customer_phone: "864-555-0100",
           delivery_date: "2025-12-15",
           delivery_time: "2:00 PM",
           service_name: "TV Mount",
           address: "123 Oak St",
           call_reason: "appointment",
           context: "Appointment tomorrow at 2 PM"
         }]

Portal → User clicks "Mark as Contacted"
       → Modal: Notes, Outcome, Follow-up Date
       → POST /api/portal_log_call
       ← Saves to h2s_call_logs
```

---

## ✅ ACCEPTANCE CRITERIA

**Phase 1-3 Complete When:**
- [ ] Pro logs into portal
- [ ] Clicks "Customers" tab
- [ ] Sees list of upcoming appointments with phone numbers
- [ ] Clicks "📞 Call Now" → phone dialer opens (mobile)
- [ ] After call, clicks "Mark as Contacted"
- [ ] Adds notes + outcome
- [ ] System saves to `h2s_call_logs`
- [ ] Customer shows as "Contacted" with timestamp

---

## 🎯 NEXT STEPS

**Ready to implement Phases 1-3 now?** This gives pros immediate value without the complexity of quote generation.

**Quote system** can be added later once you define:
- Pricing structure (base prices + add-ons)
- Discount/markup logic
- Approval workflow (if needed)

Let me know if you want me to start building the customer calling system!
