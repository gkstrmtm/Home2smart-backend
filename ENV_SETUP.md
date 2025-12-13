# Environment Variables Setup Guide
## Required Configuration for Vercel Deployment

### 🔐 Supabase (Database)
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### 📧 SendGrid (Email)
```
SENDGRID_API_KEY=SG.your_api_key_here
SENDGRID_FROM_EMAIL=contact@home2smart.com
SENDGRID_ENABLED=true
```

**Setup Instructions:**
1. Go to https://sendgrid.com/
2. Create account or log in
3. Navigate to Settings > API Keys
4. Create new API key with "Full Access"
5. Add sender verification for `contact@home2smart.com`:
   - Settings > Sender Authentication
   - Verify Single Sender
   - Use: contact@home2smart.com

### 📱 Twilio (SMS)
```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+18645281475
USE_TWILIO=true
TWILIO_ENABLED=true
```

**Setup Instructions:**
1. Go to https://www.twilio.com/console
2. Navigate to "Account > Keys & Credentials"
3. Copy Account SID and Auth Token
4. Buy a phone number if you haven't:
   - Phone Numbers > Manage > Buy a Number
   - Choose a local South Carolina number (+1 864 area code preferred)
5. Configure messaging:
   - Messaging > Settings > Geo Permissions (enable US)
   - Set up compliance profile

### 🔗 GoHighLevel (CRM Integration)
```
GHL_WEBHOOK_URL=https://services.leadconnectorhq.com/hooks/...
GHL_API_KEY=your_ghl_api_key_here
```

**Setup Instructions:**
1. Log into GoHighLevel
2. Settings > Custom Values > Webhooks
3. Create webhook for "New Lead"
4. Copy webhook URL

### 💳 Stripe (Payments)
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 🔔 Notifications
```
QUOTE_NOTIFICATION_EMAIL=dispatch@home2smart.com
BOOKING_NOTIFICATION_EMAIL=dispatch@home2smart.com
ERROR_NOTIFICATION_EMAIL=dispatch@home2smart.com
```

### 🛡️ Security
```
ADMIN_TOKEN=e5d4100f-fdbb-44c5-802c-0166d86ed1a8
JWT_SECRET=your_random_secret_here
```

---

## 📋 Verification Checklist

### SendGrid Email Test
```bash
curl -X POST https://h2s-backend.vercel.app/api/test-email \
  -H "Content-Type: application/json" \
  -d '{"to":"your-email@example.com"}'
```

### Twilio SMS Test
```bash
curl -X POST https://h2s-backend.vercel.app/api/send-sms \
  -H "Content-Type: application/json" \
  -d '{"to":"+18641234567","message":"Test from H2S"}'
```

### Quote System Test
```bash
curl -X POST https://h2s-backend.vercel.app/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "name":"Test Customer",
    "email":"test@example.com",
    "phone":"8641234567",
    "details":"Test quote request",
    "package_type":"custom"
  }'
```

---

## 🚀 Deployment Steps

1. **Add all environment variables in Vercel:**
   - Go to your project settings
   - Environment Variables section
   - Add each variable for Production, Preview, and Development

2. **Verify SendGrid sender:**
   - Must verify contact@home2smart.com before sending
   - Check spam folder for verification email

3. **Test Twilio number:**
   - Send test SMS from Twilio console
   - Verify number is active and has messaging enabled

4. **Deploy:**
   ```bash
   vercel --prod
   ```

5. **Test each endpoint above**

---

## 🔧 Troubleshooting

### "SendGrid: Sender not verified"
- Go to SendGrid > Settings > Sender Authentication
- Add and verify contact@home2smart.com

### "Twilio: Invalid phone number"
- Ensure TWILIO_PHONE_NUMBER includes country code: +18645281475
- Verify number is active in Twilio console

### "SMS not sending"
- Check time restrictions (7am-9pm EST only)
- Verify user hasn't opted out
- Check daily rate limit (3 per day per number)

### "Email bouncing"
- Verify sender domain authentication
- Check recipient email is valid
- Review SendGrid activity log

---

## 📞 Support Contacts

- **Twilio Support:** https://support.twilio.com
- **SendGrid Support:** https://support.sendgrid.com
- **GoHighLevel:** In-app chat support
