# W-9 Upload + Email Validation + Time-Off Polish - Implementation Plan

## Current State Analysis

### Files Located:
- **Onboarding UI**: `public/portalv3.html` line 12742 (`finishStep1` handler)
- **Pro Profile UI**: `public/portalv3.html` line 6252 (Professional Profile section)
- **Signup API**: `api/portal_signup_step1.js` (creates pro, sends welcome email via Apps Script)
- **File Upload Pattern**: `api/portal_upload_photo.js` (uses Supabase Storage, base64 encoding)
- **Pro Table**: `h2s_pros` (confirmed in portal_signup_step1.js, portal_me.js, portal_update_profile.js)
- **Time-Off Modal**: `public/portalv3.html` line 947 (CSS) - needs HTML location
- **Storage Buckets**: `profile-photos`, `job-artifacts` (existing)

### Current Issues:
1. **Email Validation**: Only trim + lowercase, no format validation or confirmation
2. **Welcome Email**: Sent via Apps Script (line 192 in portal_signup_step1.js) - needs migration
3. **W-9 Upload**: Not implemented
4. **Time-Off Popup**: Aggressively colored (line 947 CSS)

---

## Phase 1: W-9 Upload + Secure Storage + DB Link + Admin Visibility

### 1.1 Database Schema (Supabase SQL)

**File**: Run in Supabase SQL Editor

```sql
-- Add W-9 fields to h2s_pros table
ALTER TABLE h2s_pros
ADD COLUMN IF NOT EXISTS w9_file_url TEXT,
ADD COLUMN IF NOT EXISTS w9_uploaded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS w9_status TEXT DEFAULT 'pending' CHECK (w9_status IN ('pending', 'uploaded', 'verified', 'rejected'));

-- Index for admin queries
CREATE INDEX IF NOT EXISTS idx_pros_w9_status ON h2s_pros(w9_status) WHERE w9_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pros_w9_uploaded ON h2s_pros(w9_uploaded_at) WHERE w9_uploaded_at IS NOT NULL;
```

### 1.2 Create Supabase Storage Bucket (if not exists)

**Action**: In Supabase Dashboard → Storage → Create bucket:
- **Bucket name**: `w9-forms`
- **Public**: `false` (private)
- **File size limit**: 10MB
- **Allowed MIME types**: `application/pdf,image/jpeg,image/png`

### 1.3 API Endpoint: W-9 Upload

**File**: `api/portal_upload_w9.js` (NEW)

**Pattern**: Follow `api/portal_upload_photo.js` structure:
- Validate session
- Accept base64 file data (PDF/JPG/PNG)
- Upload to `w9-forms` bucket (private)
- Generate signed URL (temporary, admin-only access)
- Update `h2s_pros` record with `w9_file_url`, `w9_uploaded_at`, `w9_status='uploaded'`
- Return success

### 1.4 API Endpoint: Admin W-9 Access

**File**: `api/admin_get_w9.js` (NEW)

**Purpose**: Admin-only endpoint to retrieve W-9 file
- Validate admin token
- Get pro_id from query
- Generate signed URL from Supabase Storage (expires in 1 hour)
- Return URL for download/view

### 1.5 Portal UI: W-9 Upload Tile

**File**: `public/portalv3.html`

**Location**: Add after Profile Photo section (around line 6318)

**Pattern**: Dropbox-style upload tile:
- Drag & drop zone
- Tap to upload button
- File preview (if uploaded)
- Status indicator (pending/uploaded)
- Uses same upload pattern as profile photo

### 1.6 Admin UI: W-9 Visibility

**File**: `public/dispatch.html`

**Location**: In pro list/details view

**Display**:
- W-9 status badge (pending/uploaded/verified)
- Download button (calls `admin_get_w9` endpoint)
- Upload date

---

## Phase 2: Email Validation + Confirmation

### 2.1 Frontend Validation

**File**: `public/portalv3.html` (onboarding form)

**Changes**:
- Add email format validation (regex: basic email pattern)
- Add "Confirm Email" field (type twice)
- Show validation errors inline
- Block submission if emails don't match or format invalid

### 2.2 Backend Validation

**File**: `api/portal_signup_step1.js`

**Changes**:
- Add email format validation (use reasonable validator, not overly strict)
- Add `email_confirmed` flag (default `false` for new signups)
- Store email in lowercase, trimmed
- Return validation errors if email format invalid

### 2.3 Email Confirmation Flow

**Option A (Simpler)**: Double-entry confirmation
- User types email twice in onboarding
- Backend validates they match
- Mark `email_confirmed=true` if match

**Option B (More Robust)**: Confirmation code/link
- Send confirmation email with code/link
- User enters code or clicks link
- Mark `email_confirmed=true`
- Block outbound sequencing until confirmed

**Recommendation**: Start with Option A (double-entry), add Option B later if needed.

### 2.4 Onboarding Sequencing Guardrails

**Files to Audit**:
- `api/portal_signup_step1.js` (line 192 - welcome email)
- Any cron jobs or triggers that send emails to pros
- `api/notify-pro.js` (pro notifications)

**Changes**:
- Check `email_confirmed=true` before sending emails
- Check email format is valid before sending
- Log skipped emails (invalid/unconfirmed) for admin visibility

---

## Phase 3: Time-Off Popup Polish

**File**: `public/portalv3.html` (line 947 CSS)

**Changes**: CSS-only polish
- Reduce saturation in colors
- Use neutral surfaces (grays instead of bright blues)
- Clean borders (subtle, consistent)
- Consistent radius (match design system)
- Preserve clarity and hierarchy
- Mobile-first responsive

---

## Phase 4: Onboarding Sequencing Audit

**Action**: Review all email triggers for pros:
1. Welcome email (signup)
2. Job assignment notifications
3. Reminders
4. Any other automated sequences

**Guardrails**:
- Never send to invalid email format
- Never send to unconfirmed emails (for new signups)
- Log all skipped sends for admin visibility

---

## Implementation Order (Safe Path)

1. **Time-Off Popup Polish** (CSS only, zero risk)
2. **Email Validation** (Frontend + Backend, low risk)
3. **W-9 Upload** (New feature, isolated)
4. **Onboarding Sequencing** (Audit + patches, medium risk)

---

## Next Steps

After plan approval, I'll provide:
- Exact SQL patches
- Exact API endpoint code
- Exact UI patches (file paths + line numbers)
- Exact CSS patches
- Verification checklist

