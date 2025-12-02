# Home2Smart Backend

Backend API and frontend pages for Home2Smart dispatch system.

## Structure

```
api/                          # Vercel serverless endpoints
├── send-sms.js              # SMS sending (Twilio + SendGrid fallback)
├── send-email.js            # Email sending (SendGrid templates)
├── notify-pro.js            # Pro/dispatch SMS notifications
├── notify-customer.js       # Customer journey SMS automation
├── send-pro-assigned-email.js  # Pro assignment email trigger
├── portal_*.js              # Pro portal endpoints
├── admin_*.js               # Admin/dispatch portal endpoints
└── ...

*.html                       # Frontend pages
├── bundles.html             # Customer booking flow
├── portalv3.html            # Pro portal
├── dashboard.html           # Admin dashboard
└── ...

middleware/                  # Request processing
public/                      # Static assets
*.md                         # Documentation
```

## Deployment

**Vercel (Production):**
```bash
vercel --prod
```

**Environment Variables (Required):**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `TWILIO_ACCOUNT_SID` - Twilio account SID
- `TWILIO_AUTH_TOKEN` - Twilio auth token
- `TWILIO_PHONE_NUMBER` - Twilio sending number
- `SENDGRID_API_KEY` - SendGrid API key
- `SENDGRID_FROM_EMAIL` - SendGrid sender email
- `DISPATCH_PHONES` - Comma-separated dispatch phone numbers
- `USE_TWILIO` - "true" or "false" (fallback to SendGrid)

## Development

**Install:**
```bash
npm install
```

**Run locally:**
```bash
vercel dev
```

**Test endpoints:**
```bash
curl -X POST http://localhost:3000/api/send-sms \
  -H "Content-Type: application/json" \
  -d '{"phone": "+18645281475", "message": "Test"}'
```

## Key Endpoints

### SMS Communication
- `POST /api/send-sms` - Core SMS sending
- `POST /api/notify-pro` - Pro notifications (9 types)
- `POST /api/notify-customer` - Customer notifications (12 types)

### Email Communication
- `POST /api/send-email` - Core email sending
- `POST /api/send-pro-assigned-email` - Pro assignment email

### Portal (Pro)
- `POST /api/portal_login` - Pro login
- `GET /api/portal_me` - Pro profile
- `GET /api/portal_jobs` - Pro's assigned jobs
- `POST /api/portal_accept` - Accept job assignment
- `POST /api/portal_mark_done` - Mark job complete

### Admin
- `POST /api/admin_login` - Admin login
- `GET /api/admin_dispatch` - Get all jobs
- `POST /api/admin_send_offer` - Manually assign job to pro

## Documentation

- `PRO_ASSIGNMENT_EMAIL_GUIDE.md` - Pro assignment email system
- `CUSTOMER_CALLING_SYSTEM.md` - Customer communication docs
- `WHITEBOARD_CHECKLIST.md` - Development checklist

## Database

Uses Supabase PostgreSQL. Schema migrations are run directly in Supabase SQL Editor (not tracked in repo).

Key tables:
- `h2s_dispatch_jobs` - Job records
- `h2s_dispatch_pros` - Pro profiles
- `h2s_dispatch_job_assignments` - Job assignments
- `h2s_sms_log` - SMS audit trail
- `email_messages` - Email audit trail

## Notes

- SQL files are NOT tracked in repo (run directly in Supabase)
- Test files are NOT tracked (local only)
- Frontend pages are tracked for deployment
- API endpoints are tracked for Vercel serverless deployment
