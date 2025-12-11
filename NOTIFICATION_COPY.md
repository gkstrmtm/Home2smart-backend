# Notification Copy Reference

All customer-facing and internal notification messages across SMS, Email, and Push channels.

## 📍 Location of Templates

- **SMS Templates**: `api/config/notifications.js` → `SMS_TEMPLATES` object (code-based)
- **Email Templates**: Supabase database → `h2s_email_templates` table (database-driven)
- **Management Contacts**: `api/config/notifications.js` → `MANAGEMENT_CONTACTS` object

## 📱 SMS Message Templates

### Customer Journey

#### 1. Payment Confirmed
**Template Key**: `payment_confirmed`  
**Trigger**: Stripe checkout.session.completed  
**Message**:
```
Hi {firstName}, thanks for your payment of ${amount}! Schedule your {service} installation: {scheduleUrl}. Reply STOP to opt out.
```

#### 2. Appointment Scheduled
**Template Key**: `appointment_scheduled`  
**Trigger**: Customer books appointment via calendar  
**Message**:
```
Hi {firstName}, your {service} appointment is confirmed for {date} at {time}. Location: {city}, {state}. Questions? Call (864) 528-1475. Reply STOP to opt out.
```

#### 3. Appointment Reminder (24 Hours)
**Template Key**: `appointment_reminder_24h`  
**Trigger**: Cron job 24 hours before appointment  
**Message**:
```
Reminder: Your {service} appointment with Home2Smart is tomorrow at {time}. Address: {address}. See you then! Reply STOP to opt out.
```

#### 4. Appointment Reminder (2 Hours)
**Template Key**: `appointment_reminder_2h`  
**Trigger**: Cron job 2 hours before appointment  
**Message**:
```
We're on our way! Your tech {proName} will arrive at {time} for your {service} appointment. Reply STOP to opt out.
```

#### 5. Quote Received
**Template Key**: `quote_received`  
**Trigger**: Custom quote request submitted  
**Message**:
```
Thanks for your quote request! We'll contact you within 1 hour at {phone}. - Home2Smart. Reply STOP to opt out.
```

#### 6. Job Completed Thank You
**Template Key**: `job_completed_thank_you`  
**Trigger**: Technician marks job complete  
**Message**:
```
Thank you for choosing Home2Smart! Please rate your experience: {reviewUrl}. Reply STOP to opt out.
```

### Technician/Pro Notifications

#### 7. Pro Job Assigned
**Template Key**: `pro_job_assigned`  
**Trigger**: Job auto-assigned or manually assigned  
**Message**:
```
New job assigned! {service} for {customerName} on {date} at {time}. Address: {address}, {city}. View details in portal. Reply STOP to opt out.
```

#### 8. Pro Job Reminder
**Template Key**: `pro_job_reminder`  
**Trigger**: Day before job  
**Message**:
```
Job reminder: {service} appointment today at {time}. Customer: {customerName}. Address: {address}. Phone: {customerPhone}. Reply STOP to opt out.
```

### Management Internal Alerts

#### 9. New Booking Alert
**Template Key**: `mgmt_new_booking`  
**Trigger**: Payment completed  
**Recipients**: +18644502445, +18643239776, +19513318992, +18643235087  
**Message**:
```
🔔 NEW BOOKING: {service} for {customerName} on {date} at {time}. Order #{orderNumber}. Total: ${amount}. Location: {city}, {state}.
```

#### 10. High Value Order Alert
**Template Key**: `mgmt_high_value_order`  
**Trigger**: Order total >= $500  
**Recipients**: +18644502445, +18643239776, +19513318992, +18643235087  
**Message**:
```
💰 HIGH VALUE ORDER: ${amount} - {service} for {customerName}. Order #{orderNumber}. Payment confirmed.
```

#### 11. Pro Assignment Failed
**Template Key**: `mgmt_pro_assignment_failed`  
**Trigger**: Auto-assignment fails (no available pros)  
**Recipients**: +18644502445, +18643239776, +19513318992, +18643235087  
**Message**:
```
⚠️ ASSIGNMENT FAILED: Job #{jobId} for {service} on {date} at {time}. No available pros. Manual assignment needed.
```

#### 12. Quote Request Alert
**Template Key**: `mgmt_quote_request`  
**Trigger**: Custom quote form submitted  
**Recipients**: +18644502445, +18643239776, +19513318992, +18643235087  
**Message**:
```
📋 NEW QUOTE: {customerName} ({phone}) - {service}. Details: {details}
```

---

## 📧 Email Templates

Email templates are stored in **Supabase → `h2s_email_templates` table**.

### Template Structure
Each template has:
- `template_key`: Unique identifier (matches SMS template keys)
- `subject`: Email subject line
- `html_body`: HTML email content with {variable} placeholders
- `text_body`: Plain text fallback
- `is_active`: Boolean flag to enable/disable

### Key Email Templates

#### Payment Confirmation
- **Subject**: `Payment Confirmed - {service} Installation | Home2Smart`
- **From**: contact@home2smart.com
- **Content**: Receipt with order details, payment breakdown, scheduling link

#### Appointment Scheduled
- **Subject**: `Appointment Confirmed - {service} on {date} | Home2Smart`
- **From**: contact@home2smart.com
- **Content**: Appointment details, technician info (if assigned), cancellation policy

#### Appointment Reminder
- **Subject**: `Tomorrow: Your {service} Appointment | Home2Smart`
- **From**: contact@home2smart.com
- **Content**: Reminder with date/time, preparation instructions, contact info

#### Pro Job Assignment
- **Subject**: `New Job Assignment - {service} on {date}`
- **From**: dispatch@home2smart.com
- **Content**: Job details, customer info, address, special instructions

#### Management Alerts
- **Subject**: `🔔 New Booking: {service} - Order #{orderNumber}` (etc.)
- **From**: dispatch@home2smart.com
- **Content**: Full order/job details for internal tracking

---

## 🔧 Editing Message Copy

### To Edit SMS Messages:
1. Open `api/config/notifications.js`
2. Find template in `SMS_TEMPLATES` object
3. Edit the `message` property
4. Deploy to Vercel: `vercel --prod`

### To Edit Email Messages:
1. Access Supabase dashboard
2. Navigate to `h2s_email_templates` table
3. Edit `subject`, `html_body`, or `text_body` columns
4. Changes take effect immediately (no deployment needed)

### Variable Placeholders:
Use `{variableName}` format. Common variables:
- `{firstName}` - Customer first name
- `{service}` - Service name (e.g., "Smart TV Installation")
- `{date}` - Formatted date
- `{time}` - Appointment time
- `{amount}` - Dollar amount
- `{address}` - Full address
- `{city}`, `{state}` - Location
- `{orderNumber}` - Order ID
- `{phone}` - Phone number
- `{scheduleUrl}` - Booking calendar link
- `{reviewUrl}` - Review request link

---

## 📞 Management Contact Configuration

**File**: `api/config/notifications.js` → `MANAGEMENT_CONTACTS`

### Current Management Phones:
1. **+18644502445** - Management 1
2. **+18643239776** - Management 2
3. **+19513318992** - Management 3
4. **+18643235087** - Management 4

### Management Emails:
- dispatch@home2smart.com
- tabari@home2smart.com

### Alert Preferences:
- New Bookings: ✅ Enabled
- High Value Orders (>$500): ✅ Enabled
- Pro Assignment Failures: ✅ Enabled
- Quote Requests: ✅ Enabled

---

## 🚨 Compliance Settings

### SMS Compliance
**File**: `api/config/notifications.js` → `SMS_COMPLIANCE`

- **Opt-Out Keywords**: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT
- **Opt-In Keywords**: START, YES, UNSTOP
- **Help Keywords**: HELP, INFO
- **Help Response**: "Home2Smart: For support, call (864) 528-1475. Reply STOP to unsubscribe."
- **Time Restrictions**: 7am - 9pm EST
- **Rate Limiting**: Max 3 SMS per day, 10 per week per number

### Twilio Configuration
- **From Number**: +18643878413
- **Account**: Configured in Vercel env vars
- **Status Callbacks**: Enabled for delivery tracking

---

## 📊 Notification Flow Map

```
┌─────────────────────────────────────────────────────────┐
│                    CUSTOMER JOURNEY                      │
└─────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
    [Payment]        [Scheduling]        [Service]
        │                  │                  │
        ├─ Payment Confirmed (SMS + Email)   │
        │                  │                  │
        │  ┌───────────────┴─────┐           │
        │  │                     │           │
        │  ├─ Appointment Scheduled (SMS + Email)
        │  │                     │           │
        │  ├─ Reminder 24h (SMS) │           │
        │  │                     │           │
        │  └─ Reminder 2h (SMS)  │           │
        │                        │           │
        └────────────────────────┴───────────┴─ Job Complete + Review Request
                                              
┌─────────────────────────────────────────────────────────┐
│                   TECHNICIAN FLOW                        │
└─────────────────────────────────────────────────────────┘
        │
        ├─ Job Assigned (SMS + Email)
        │
        ├─ Day-Before Reminder (SMS)
        │
        └─ Job Complete Confirmation

┌─────────────────────────────────────────────────────────┐
│                   MANAGEMENT ALERTS                      │
└─────────────────────────────────────────────────────────┘
        │
        ├─ New Booking (SMS + Email) → 4 numbers
        │
        ├─ High Value Order (SMS + Email) → 4 numbers
        │
        ├─ Quote Request (SMS + Email) → 4 numbers
        │
        └─ Pro Assignment Failed (SMS + Email) → 4 numbers
```

---

## 🔄 Next Steps / Missing Features

### Bundles Page Enhancements Needed:

1. **Reschedule Capability**
   - Add "Reschedule" button to account page order list
   - Link to GHL calendar with pre-filled order_id
   - Update `delivery_date` and `delivery_time` in database
   - Send reschedule confirmation SMS/email

2. **Manage Appointments UI**
   - Show upcoming appointments on account dashboard
   - Cancel appointment button with confirmation
   - View appointment details (assigned tech, time window)

3. **Success Page Improvements**
   - Add "Already scheduled? Reschedule here" link
   - Show scheduled appointment details if returning

---

## 📝 Testing Commands

### Test SMS:
```powershell
Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/send-sms" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"to":"+18644502445","message":"Test message - Reply STOP to opt out"}'
```

### Test Email:
```powershell
Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/test-sendgrid"
```

### Test Management Notification:
```powershell
Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/notify-management" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"type":"newBooking","data":{"service":"Test Service","customerName":"Test Customer","date":"Jan 15","time":"2:00 PM","orderNumber":"ABC123","amount":"599.00","city":"Greenville","state":"SC","phone":"864-555-1234"}}'
```

---

**Last Updated**: December 10, 2025  
**Maintained By**: Dispatch Team  
**Questions**: contact@home2smart.com
