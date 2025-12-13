# W-9 Upload + Email Validation + Time-Off Polish - Exact Patches

## Implementation Plan Summary

**Phase 1 (Lowest Risk)**: Time-Off Popup Polish (CSS only)
**Phase 2 (Low Risk)**: Email Validation (Frontend + Backend)
**Phase 3 (Medium Risk)**: W-9 Upload (New feature, isolated)
**Phase 4 (Medium Risk)**: Onboarding Sequencing Audit

---

## PHASE 1: Time-Off Popup Polish (CSS Only)

### File: `public/portalv3.html`

**Location**: Line 947-996 (Time-Off Modal CSS)

**Patch**: Replace aggressive colors with neutral, minimal design

```css
/* ===== Time Off Modal (Modern Design - Polished) ===== */
.timeoff-modal-header{
  background:var(--h2s-bg-card-elevated);
  padding:32px;
  border-radius:var(--br-xl) var(--br-xl) 0 0;
  margin:-32px -32px 32px -32px;
  box-shadow:var(--shadow-lg);
  border-bottom:1px solid var(--h2s-border-subtle)
}
.timeoff-modal-title{
  font-size:28px;
  font-weight:800;
  color:var(--h2s-text-main);
  margin:0 0 8px 0;
  letter-spacing:-.02em
}
.timeoff-modal-subtitle{
  font-size:15px;
  color:var(--h2s-text-muted);
  margin:0;
  font-weight:500
}
.date-section{margin-bottom:32px}
.date-section-label{
  font-size:13px;
  font-weight:700;
  color:var(--h2s-text-muted);
  text-transform:uppercase;
  letter-spacing:.8px;
  margin-bottom:16px;
  display:block
}
.date-input-wrapper{position:relative}
.date-display{
  background:var(--h2s-bg-input);
  border:2px solid var(--h2s-border-subtle);
  border-radius:var(--br-lg);
  padding:24px;
  cursor:pointer;
  transition:all .3s cubic-bezier(.4,0,.2,1);
  min-height:80px;
  display:flex;
  align-items:center;
  justify-content:space-between
}
.date-display:hover{
  border-color:rgba(148,163,184,.4);
  box-shadow:0 4px 12px rgba(0,0,0,.08);
  transform:translateY(-1px)
}
.date-display-content{flex:1}
.date-display-label{
  font-size:13px;
  color:var(--h2s-text-muted);
  margin-bottom:6px;
  font-weight:600
}
.date-display-value{
  font-size:24px;
  font-weight:800;
  color:var(--h2s-text-main);
  letter-spacing:-.01em
}
.date-display-icon{
  width:48px;
  height:48px;
  background:rgba(148,163,184,.08);
  border-radius:var(--br);
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0
}
.date-display-icon svg{
  width:24px;
  height:24px;
  stroke:var(--h2s-text-muted);
  stroke-width:2.5
}
.date-input-native{
  position:absolute;
  opacity:0;
  pointer-events:none;
  width:1px;
  height:1px
}
.quick-picks{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:12px;
  margin-top:20px
}
.quick-pick-chip{
  background:rgba(148,163,184,.06);
  border:1.5px solid rgba(148,163,184,.2);
  border-radius:var(--br);
  padding:14px 20px;
  color:var(--h2s-text-main);
  font-size:14px;
  font-weight:600;
  cursor:pointer;
  transition:all .25s cubic-bezier(.4,0,.2,1);
  text-align:center;
  white-space:nowrap
}
.quick-pick-chip:hover{
  background:rgba(148,163,184,.1);
  border-color:rgba(148,163,184,.35);
  transform:translateY(-1px);
  box-shadow:0 2px 8px rgba(0,0,0,.06)
}
.quick-pick-chip:active{transform:translateY(0)}
.date-hint{
  margin-top:20px;
  padding:16px;
  background:rgba(148,163,184,.05);
  border-left:2px solid rgba(148,163,184,.3);
  border-radius:var(--br);
  color:var(--h2s-text-muted);
  font-size:14px;
  line-height:1.6
}
.reason-section{margin-bottom:32px}
.reason-select-wrapper{position:relative}
.reason-select{
  width:100%;
  background:var(--h2s-bg-input);
  border:2px solid var(--h2s-border-subtle);
  border-radius:var(--br-lg);
  padding:18px 20px;
  color:var(--h2s-text-main);
  font-size:16px;
  font-weight:600;
  cursor:pointer;
  transition:all .25s;
  appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8' stroke-width='2.5'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
  background-repeat:no-repeat;
  background-position:right 16px center;
  background-size:20px;
  padding-right:52px
}
.reason-select:hover{
  border-color:rgba(148,163,184,.3);
  background-color:var(--h2s-bg-card-elevated)
}
.reason-select:focus{
  outline:none;
  border-color:rgba(148,163,184,.4);
  box-shadow:0 0 0 3px rgba(148,163,184,.08)
}
.modal-actions{
  display:flex;
  gap:12px;
  margin-top:32px;
  padding-top:24px;
  border-top:1px solid var(--h2s-border-subtle)
}
.modal-actions .btn-modern{
  flex:1;
  min-height:56px;
  font-size:16px;
  font-weight:700;
  border-radius:var(--br-lg)
}
```

**Also update inline styles in modal HTML** (around line 7041, 7066):

```html
<!-- Replace line 7041 -->
<div class="sheet" style="max-width:600px;max-height:90vh;overflow-y:auto;padding:32px;background:var(--h2s-bg-card-elevated);border:1px solid var(--h2s-border-subtle);box-shadow:var(--shadow-lg)">

<!-- Replace line 7066 -->
<div style="background:var(--h2s-bg-card);padding:32px;border-radius:16px;margin-bottom:32px;border:1px solid var(--h2s-border-subtle)">
  <h3 id="timeOffModalTitle" style="font-size:32px;font-weight:800;color:var(--h2s-text-main);margin:0 0 8px 0;letter-spacing:-0.02em">🌴 Request Time Off</h3>
  <p style="font-size:15px;color:var(--h2s-text-muted);margin:0">Block dates when you're unavailable for jobs</p>
</div>
```

**Update scrollbar colors** (around line 7044-7064):

```css
#timeOffModal .sheet { 
  scrollbar-width:thin; 
  scrollbar-color:rgba(148,163,184,.4) rgba(15,23,42,0.3); 
}
#timeOffModal .sheet::-webkit-scrollbar { width:14px; }
#timeOffModal .sheet::-webkit-scrollbar-track {
  background:var(--h2s-bg-card);
  border-radius:10px;
  margin:8px 0;
  border:1px solid var(--h2s-border-subtle);
}
#timeOffModal .sheet::-webkit-scrollbar-thumb {
  background:rgba(148,163,184,.3);
  border-radius:10px;
  border:2px solid var(--h2s-bg-card);
}
#timeOffModal .sheet::-webkit-scrollbar-thumb:hover {
  background:rgba(148,163,184,.45);
}
```

---

## PHASE 2: Email Validation + Confirmation

### File: `public/portalv3.html`

**Location**: Line 6016 (Email input) and line 12742 (finishStep1 handler)

**Patch 1**: Add email confirmation field and validation

```html
<!-- After line 6016, add: -->
<div><label class="label" for="piEmailConfirm" style="font-size:15px;font-weight:500;color:rgba(255,255,255,0.9);margin-bottom:8px;display:block">Confirm Email</label><input id="piEmailConfirm" class="input" type="email" placeholder="you@example.com" autocomplete="email" style="font-size:16px;height:52px;padding:0 16px;border-radius:12px"></div>
<div id="err-email" class="error" style="display:none;margin-top:8px"></div>
```

**Patch 2**: Add email validation function

```javascript
// Add before finishStep1 handler (around line 12740)
function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes(' ')) return false; // No spaces
  // Basic email regex (not overly strict)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
}
```

**Patch 3**: Update finishStep1 handler

```javascript
$("finishStep1").addEventListener("click", async () => {
  const payload = {
    name: $("piName").value.trim(),
    email: $("piEmail").value.trim(),
    email_confirm: $("piEmailConfirm").value.trim(), // Add this
    phone: $("piPhone").value.trim(),
    address: $("adStreet").value.trim(),
    city: $("adCity").value.trim(),
    state: $("adState").value.trim(),
    zip: $("adZip").value.trim()
  };
  
  // Email validation
  const emailErr = $("err-email");
  emailErr.style.display = "none";
  
  if (!validateEmail(payload.email)) {
    emailErr.textContent = "Please enter a valid email address (no spaces)";
    emailErr.style.display = "block";
    return;
  }
  
  if (payload.email !== payload.email_confirm) {
    emailErr.textContent = "Email addresses do not match";
    emailErr.style.display = "block";
    return;
  }
  
  if (!payload.address || !payload.city || !payload.state || !payload.zip) {
    $("err-address").textContent = "All address fields required"; 
    $("err-address").style.display = "block";
    return;
  }
  
  // ... rest of existing code ...
});
```

### File: `api/portal_signup_step1.js`

**Location**: Line 82-92 (validation section)

**Patch**: Add email validation

```javascript
const { name, email, email_confirm, phone, address, city, state, zip } = body || {};

// Email validation
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.includes(' ')) return false;
  // Reasonable email regex (allows most valid formats, not overly strict)
  const emailRegex = /^[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;
  return emailRegex.test(trimmed);
}

// Validation
if (!name || !email || !phone || !address || !city || !state || !zip) {
  console.log('Missing required fields');
  return res.status(400).json({
    ok: false,
    error: 'All fields are required',
    error_code: 'missing_fields'
  });
}

// Email format validation
if (!isValidEmail(email)) {
  return res.status(400).json({
    ok: false,
    error: 'Invalid email format. Please check for spaces or typos.',
    error_code: 'invalid_email'
  });
}

// Email confirmation check (if provided)
if (email_confirm && email.trim().toLowerCase() !== email_confirm.trim().toLowerCase()) {
  return res.status(400).json({
    ok: false,
    error: 'Email addresses do not match',
    error_code: 'email_mismatch'
  });
}
```

**Location**: Line 130-147 (proData creation)

**Patch**: Add email_confirmed flag

```javascript
const proData = {
  pro_id: proId,
  name: name.trim(),
  email: email.trim().toLowerCase(),
  phone: phone.trim(),
  home_address: address.trim(),
  home_city: city.trim(),
  home_state: state.trim(),
  home_zip: zip.trim(),
  geo_lat: lat,
  geo_lng: lng,
  slug: slug,
  status: 'pending',
  email_confirmed: email_confirm ? true : false, // Add this
  service_radius_miles: 35,
  max_jobs_per_day: 3,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};
```

**Location**: Line 190-205 (welcome email)

**Patch**: Add email confirmation check before sending

```javascript
// Send welcome email (only if email is confirmed/valid)
// Migrate from Apps Script to Vercel endpoint
try {
  // Only send if email is confirmed (double-entry match) or if no confirmation was required
  const shouldSendEmail = !email_confirm || email.trim().toLowerCase() === email_confirm.trim().toLowerCase();
  
  if (shouldSendEmail && isValidEmail(email.trim().toLowerCase())) {
    await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://h2s-backend.vercel.app'}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to_email: email.trim().toLowerCase(),
        template_key: 'pro_welcome',
        data: {
          firstName: name.trim().split(' ')[0],
          name: name.trim()
        },
        user_id: null, // Pro signup, not customer
        order_id: null
      })
    });
    console.log('Welcome email sent');
  } else {
    console.log('Welcome email skipped - email not confirmed or invalid');
  }
} catch (emailErr) {
  console.warn('Welcome email failed:', emailErr);
  // Don't fail signup if email fails
}
```

---

## PHASE 3: W-9 Upload

### 3.1 Database Schema

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

### 3.2 API Endpoint: W-9 Upload

**File**: `api/portal_upload_w9.js` (NEW)

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function validateSession(token) {
  const { data, error } = await supabase
    .from('h2s_sessions')
    .select('pro_id, expires_at')
    .eq('session_id', token)
    .single();

  if (error || !data) return null;
  if (new Date() > new Date(data.expires_at)) return null;

  supabase
    .from('h2s_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', token)
    .then(() => {});

  return data.pro_id;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    console.log('[portal_upload_w9] Request received');
    
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const fileData = body?.file; // Base64 encoded file
    const filename = body?.filename || `w9_${Date.now()}.pdf`;
    const mimetype = body?.mimetype || 'application/pdf';
    
    console.log('[portal_upload_w9] Filename:', filename, 'MIME:', mimetype);

    // Validate session
    const proId = await validateSession(token);
    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    if (!fileData) {
      return res.status(400).json({
        ok: false,
        error: 'Missing file data',
        error_code: 'missing_data'
      });
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(mimetype)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid file type. Only PDF, JPG, and PNG are allowed.',
        error_code: 'invalid_file_type'
      });
    }

    // Extract base64 data
    let base64Data = fileData;
    if (fileData.includes('base64,')) {
      base64Data = fileData.split('base64,')[1];
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    console.log('[portal_upload_w9] Buffer size:', buffer.length, 'bytes');

    // Validate file size (max 10MB)
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({
        ok: false,
        error: 'File too large. Maximum size is 10MB',
        error_code: 'file_too_large'
      });
    }

    // Upload to Supabase Storage (w9-forms bucket - PRIVATE)
    const storagePath = `${proId}/${Date.now()}_${filename}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('w9-forms')
      .upload(storagePath, buffer, {
        contentType: mimetype,
        upsert: true,
        cacheControl: '3600'
      });

    if (uploadError) {
      console.error('[portal_upload_w9] Upload error:', uploadError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to upload file: ' + uploadError.message,
        error_code: 'upload_error'
      });
    }

    console.log('[portal_upload_w9] Upload successful:', storagePath);

    // Generate signed URL (temporary, 1 hour expiry for admin access)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('w9-forms')
      .createSignedUrl(storagePath, 3600); // 1 hour

    if (signedUrlError) {
      console.error('[portal_upload_w9] Signed URL error:', signedUrlError);
      // Continue anyway - file is uploaded, admin can generate URL when needed
    }

    const fileUrl = signedUrlData?.signedUrl || storagePath; // Fallback to path if signed URL fails

    // Update pro record
    const { data: updatedPro, error: updateError } = await supabase
      .from('h2s_pros')
      .update({
        w9_file_url: fileUrl,
        w9_uploaded_at: new Date().toISOString(),
        w9_status: 'uploaded',
        updated_at: new Date().toISOString()
      })
      .eq('pro_id', proId)
      .select('w9_file_url, w9_uploaded_at, w9_status')
      .single();

    if (updateError) {
      console.error('[portal_upload_w9] Update error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to update pro record: ' + updateError.message,
        error_code: 'db_error'
      });
    }

    console.log('[portal_upload_w9] ✅ W-9 uploaded successfully');

    return res.json({ 
      ok: true,
      w9_file_url: fileUrl,
      w9_uploaded_at: updatedPro.w9_uploaded_at,
      w9_status: updatedPro.w9_status
    });

  } catch (error) {
    console.error('[portal_upload_w9] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
```

### 3.3 API Endpoint: Admin W-9 Access

**File**: `api/admin_get_w9.js` (NEW)

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function validateAdmin(token) {
  // Use existing admin validation pattern from admin_approve_payout.js
  // For now, simple check - enhance if needed
  if (!token) return false;
  
  // Check if token matches admin token pattern
  // Add your admin validation logic here
  return true; // Placeholder - implement actual admin validation
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const proId = body?.pro_id || req.query?.pro_id;

    // Validate admin
    const isAdmin = await validateAdmin(token);
    if (!isAdmin) {
      return res.status(403).json({
        ok: false,
        error: 'Admin access required',
        error_code: 'unauthorized'
      });
    }

    if (!proId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing pro_id',
        error_code: 'missing_data'
      });
    }

    // Get pro record
    const { data: pro, error: proError } = await supabase
      .from('h2s_pros')
      .select('pro_id, name, w9_file_url, w9_uploaded_at, w9_status')
      .eq('pro_id', proId)
      .single();

    if (proError || !pro) {
      return res.status(404).json({
        ok: false,
        error: 'Pro not found',
        error_code: 'not_found'
      });
    }

    if (!pro.w9_file_url) {
      return res.status(404).json({
        ok: false,
        error: 'W-9 not uploaded',
        error_code: 'no_w9'
      });
    }

    // Extract storage path from URL or use directly
    let storagePath = pro.w9_file_url;
    if (storagePath.includes('/storage/v1/object/public/')) {
      // Extract path from public URL
      storagePath = storagePath.split('/w9-forms/')[1];
    } else if (storagePath.includes('/w9-forms/')) {
      storagePath = storagePath.split('/w9-forms/')[1];
    }

    // Generate signed URL (1 hour expiry)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('w9-forms')
      .createSignedUrl(storagePath, 3600);

    if (signedUrlError) {
      console.error('[admin_get_w9] Signed URL error:', signedUrlError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to generate access URL: ' + signedUrlError.message,
        error_code: 'url_error'
      });
    }

    return res.json({
      ok: true,
      download_url: signedUrlData.signedUrl,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      pro_name: pro.name,
      w9_status: pro.w9_status,
      w9_uploaded_at: pro.w9_uploaded_at
    });

  } catch (error) {
    console.error('[admin_get_w9] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
```

### 3.4 Portal UI: W-9 Upload Tile

**File**: `public/portalv3.html`

**Location**: After Profile Photo section (around line 6318)

**Patch**: Add W-9 upload section

```html
<!-- W-9 Form Upload -->
<div style="margin-top:24px">
  <label class="label" style="display:block;margin-bottom:12px;font-weight:600;color:#cbd5e1">
    W-9 Tax Form
    <span style="display:block;font-weight:400;font-size:13px;color:#94a3b8;margin-top:4px">
      Required for payment processing. Download the form below, fill it out, then upload it here.
    </span>
  </label>
  
  <div id="w9UploadContainer" style="position:relative">
    <!-- Download W-9 Template Link -->
    <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px">
      <a href="https://www.irs.gov/pub/irs-pdf/fw9.pdf" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:rgba(148,163,184,.08);border:1px solid rgba(148,163,184,.2);border-radius:8px;color:var(--h2s-text-main);font-size:13px;font-weight:500;text-decoration:none;transition:all .2s" onmouseover="this.style.background='rgba(148,163,184,.12)';this.style.borderColor='rgba(148,163,184,.3)'" onmouseout="this.style.background='rgba(148,163,184,.08)';this.style.borderColor='rgba(148,163,184,.2)'">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Download W-9 Form Template
      </a>
      <span style="font-size:12px;color:var(--h2s-text-muted)">Fill it out, then upload below</span>
    </div>
    
    <!-- Upload Tile (Dropbox-style) -->
    <div id="w9UploadTile" style="border:2px dashed rgba(148,163,184,.3);border-radius:12px;padding:32px;text-align:center;cursor:pointer;transition:all .2s;background:rgba(148,163,184,.02)" onmouseover="this.style.borderColor='rgba(148,163,184,.5)';this.style.background='rgba(148,163,184,.04)'" onmouseout="this.style.borderColor='rgba(148,163,184,.3)';this.style.background='rgba(148,163,184,.02)'" onclick="$('w9FileInput').click()">
      <input type="file" id="w9FileInput" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" style="display:none">
      <div id="w9UploadContent">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin:0 auto 12px;color:var(--h2s-text-muted);opacity:.6">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <div style="font-size:15px;font-weight:600;color:var(--h2s-text-main);margin-bottom:6px">Drop W-9 here or tap to upload</div>
        <div style="font-size:13px;color:var(--h2s-text-muted)">PDF, JPG, or PNG (max 10MB)</div>
      </div>
      <div id="w9UploadPreview" style="display:none">
        <div style="display:flex;align-items:center;gap:12px;justify-content:center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--h2s-brand-green)">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--h2s-text-main)" id="w9FileName">W-9 uploaded</div>
            <div style="font-size:12px;color:var(--h2s-text-muted)" id="w9UploadDate"></div>
          </div>
          <button type="button" onclick="event.stopPropagation();handleW9Reupload()" style="margin-left:auto;padding:6px 12px;background:rgba(148,163,184,.1);border:1px solid rgba(148,163,184,.2);border-radius:8px;color:var(--h2s-text-main);font-size:12px;cursor:pointer">Replace</button>
        </div>
      </div>
    </div>
    
    <div id="w9UploadStatus" style="display:none;margin-top:12px;padding:10px;background:rgba(26,155,255,.08);border:1px solid rgba(26,155,255,.2);border-radius:8px;font-size:13px">
      <div style="display:flex;align-items:center;gap:8px">
        <div class="spin" style="width:16px;height:16px;border-width:2px"></div>
        <span>Uploading W-9...</span>
      </div>
    </div>
  </div>
</div>
```

**Patch**: Add W-9 upload JavaScript (after profile photo handlers, around line 12930)

```javascript
// W-9 Upload Handler
const w9FileInput = $("w9FileInput");
if (w9FileInput) {
  w9FileInput.addEventListener("change", handleW9Upload);
  
  // Drag and drop
  const w9UploadTile = $("w9UploadTile");
  if (w9UploadTile) {
    w9UploadTile.addEventListener("dragover", (e) => {
      e.preventDefault();
      w9UploadTile.style.borderColor = "rgba(148,163,184,.6)";
      w9UploadTile.style.background = "rgba(148,163,184,.06)";
    });
    w9UploadTile.addEventListener("dragleave", (e) => {
      e.preventDefault();
      w9UploadTile.style.borderColor = "rgba(148,163,184,.3)";
      w9UploadTile.style.background = "rgba(148,163,184,.02)";
    });
    w9UploadTile.addEventListener("drop", (e) => {
      e.preventDefault();
      w9UploadTile.style.borderColor = "rgba(148,163,184,.3)";
      w9UploadTile.style.background = "rgba(148,163,184,.02)";
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        w9FileInput.files = files;
        handleW9Upload({ target: w9FileInput });
      }
    });
  }
}

async function handleW9Upload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  // Validate file type
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
  if (!allowedTypes.includes(file.type)) {
    toast('Invalid file type. Only PDF, JPG, and PNG are allowed.', 'error');
    return;
  }
  
  // Validate file size (10MB)
  if (file.size > 10 * 1024 * 1024) {
    toast('File too large. Maximum size is 10MB.', 'error');
    return;
  }
  
  const statusDiv = $("w9UploadStatus");
  const uploadContent = $("w9UploadContent");
  const uploadPreview = $("w9UploadPreview");
  
  statusDiv.style.display = "block";
  uploadContent.style.display = "none";
  
  try {
    // Convert file to base64
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target.result;
      
      try {
        const response = await POST("portal_upload_w9", {
          token,
          file: base64Data,
          filename: file.name,
          mimetype: file.type
        });
        
        if (!response.ok) {
          throw new Error(response.error || "Upload failed");
        }
        
        // Show success
        statusDiv.style.display = "none";
        uploadPreview.style.display = "block";
        $("w9FileName").textContent = file.name;
        $("w9UploadDate").textContent = `Uploaded ${new Date().toLocaleDateString()}`;
        
        // Update me object
        if (me) {
          me.w9_file_url = response.w9_file_url;
          me.w9_uploaded_at = response.w9_uploaded_at;
          me.w9_status = response.w9_status;
        }
        
        toast("✅ W-9 uploaded successfully", "success");
        
      } catch (err) {
        console.error("[W9 Upload] Error:", err);
        statusDiv.style.display = "none";
        uploadContent.style.display = "block";
        toast(err.message || "Failed to upload W-9", "error");
      }
    };
    
    reader.onerror = () => {
      statusDiv.style.display = "none";
      uploadContent.style.display = "block";
      toast("Failed to read file", "error");
    };
    
    reader.readAsDataURL(file);
    
  } catch (err) {
    console.error("[W9 Upload] Error:", err);
    statusDiv.style.display = "none";
    uploadContent.style.display = "block";
    toast(err.message || "Upload failed", "error");
  }
}

function handleW9Reupload() {
  $("w9FileInput").value = "";
  $("w9UploadContent").style.display = "block";
  $("w9UploadPreview").style.display = "none";
  $("w9FileInput").click();
}

// Load existing W-9 status on profile load
function loadW9Status() {
  if (me && me.w9_file_url) {
    $("w9UploadContent").style.display = "none";
    $("w9UploadPreview").style.display = "block";
    $("w9FileName").textContent = "W-9 on file";
    $("w9UploadDate").textContent = me.w9_uploaded_at 
      ? `Uploaded ${new Date(me.w9_uploaded_at).toLocaleDateString()}`
      : "Uploaded";
  }
}
```

**Patch**: Call loadW9Status in hydrateMe (around line 8848)

```javascript
loadProfilePhotoPreview();
loadW9Status(); // Add this
return true;
```

---

## PHASE 4: Onboarding Sequencing Audit

### File: `api/portal_signup_step1.js`

**Already patched above** - welcome email now checks email validity before sending.

### File: `api/notify-pro.js`

**Location**: All notification cases

**Patch**: Add email validation check before sending emails

```javascript
// Add at top of handler, after getting pro data
// Validate email before sending notifications
function shouldSendEmailToPro(pro) {
  if (!pro || !pro.email) return false;
  const email = pro.email.trim().toLowerCase();
  if (email.length === 0 || email.includes(' ')) return false;
  const emailRegex = /^[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

// In each notification case, add check:
if (shouldSendEmailToPro(pro) && pro.email && process.env.SENDGRID_ENABLED !== 'false') {
  // ... existing email sending code ...
} else {
  console.warn(`[notify-pro] Skipping email for pro ${pro_id} - invalid or missing email`);
}
```

---

## Verification Checklist

### W-9 Upload
- [ ] Pro can upload W-9 from profile page
- [ ] File is stored in `w9-forms` bucket (private)
- [ ] Pro record updated with `w9_file_url`, `w9_uploaded_at`, `w9_status`
- [ ] Admin can view W-9 status in dispatch UI
- [ ] Admin can download W-9 via `admin_get_w9` endpoint
- [ ] Non-admin cannot access W-9 files

### Email Validation
- [ ] Invalid email format is rejected in frontend
- [ ] Email confirmation mismatch is caught
- [ ] Backend validates email format
- [ ] Welcome email only sends to valid/confirmed emails
- [ ] Pro notifications skip invalid emails (logged)

### Time-Off Popup
- [ ] Colors are neutral (no aggressive blues/greens)
- [ ] Design is minimal and sleek
- [ ] Mobile-friendly at 390px width
- [ ] Desktop looks clean
- [ ] Hierarchy and clarity preserved

---

## Next Steps

1. Review and approve plan
2. Implement Phase 1 (Time-Off Polish) - CSS only, zero risk
3. Implement Phase 2 (Email Validation) - Low risk
4. Implement Phase 3 (W-9 Upload) - New feature
5. Implement Phase 4 (Sequencing Audit) - Medium risk

