# Email Styling Standards

## Overview
All email templates stored in Supabase `h2s_email_templates` table must follow these standards for consistent, mobile-friendly rendering.

## Core Standards

### Container
- **Max Width:** `600px` (prevents wide text on desktop)
- **Background:** `#f8f9fa` or `#ffffff` (light, clean)
- **Padding:** `20px` on mobile, `30px` on desktop (use media queries)

### Typography
- **Font Family:** `Arial, sans-serif` or `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Base Font Size:** `16px` (body text)
- **Line Height:** `1.6` (body), `1.4` (headings)
- **Headings:** 
  - H1: `24px`, `font-weight: 700`
  - H2: `20px`, `font-weight: 600`
  - H3: `18px`, `font-weight: 600`

### Colors
- **Primary Text:** `#0a2a5a` or `#1a1a1a` (dark, readable)
- **Secondary Text:** `#64748b` or `#666666` (muted)
- **Links:** `#1493ff` or `#1A9BFF` (brand blue)
- **Background Sections:** Light tints (`rgba(20,147,255,0.1)`)

### Buttons
- **Padding:** `12px 24px` (vertical, horizontal)
- **Font Size:** `15px` or `16px`
- **Border Radius:** `6px` or `8px`
- **Background:** `#1493ff` or gradient `linear-gradient(135deg, #1493ff 0%, #0f7acc 100%)`
- **Color:** `#ffffff`
- **Min Height:** `44px` (mobile tap target)
- **Display:** `inline-block` (not block, allows centering)

### Spacing
- **Section Padding:** `20px` to `30px`
- **Element Gaps:** `16px` to `24px` between major sections
- **Small Gaps:** `8px` to `12px` between related items
- **Mobile Padding:** Reduce by 20% on screens < 480px

### Mobile Responsive
```css
@media only screen and (max-width: 480px) {
  /* Reduce padding */
  .container { padding: 16px !important; }
  
  /* Stack elements */
  .button { width: 100% !important; display: block !important; }
  
  /* Adjust font sizes */
  h1 { font-size: 20px !important; }
  h2 { font-size: 18px !important; }
  
  /* Ensure readable line height */
  p { line-height: 1.6 !important; }
}
```

## Template Structure Pattern

```html
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8f9fa; padding: 20px;">
  <!-- Header -->
  <div style="background: #0a2a5a; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Title</h1>
  </div>
  
  <!-- Content -->
  <div style="background: white; padding: 30px; border-radius: 0 0 8px 8px;">
    <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #1a1a1a;">
      Body text here
    </p>
    
    <!-- Button -->
    <div style="text-align: center; margin-top: 24px;">
      <a href="#" style="display: inline-block; background: #1493ff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; min-height: 44px; line-height: 20px;">
        Button Text
      </a>
    </div>
  </div>
</div>
```

## Templates to Audit

### 1. `pro_assigned` (Customer)
- **Trigger:** Tech accepts job
- **Check:** Max width, button style, mobile padding
- **Location:** Supabase `h2s_email_templates` table

### 2. `appointment_rescheduled` (Customer + Tech)
- **Trigger:** Job rescheduled
- **Check:** Old time + new time clearly shown, consistent spacing
- **Location:** Supabase `h2s_email_templates` table

### 3. `job_completed_thank_you` (Customer)
- **Trigger:** Job marked complete
- **Check:** Review link button, thank you message, next steps
- **Location:** Supabase `h2s_email_templates` table

### 4. `pro_new_job_assignment` (Tech)
- **Trigger:** Offer sent to tech
- **Check:** Job details, accept button (if email), mobile-friendly
- **Location:** Supabase `h2s_email_templates` table (if exists) or `notify-pro.js` SMS only

### 5. Reminder Templates
- **Trigger:** Cron jobs
- **Check:** Date/time formatting, consistent styling
- **Location:** Supabase `h2s_email_templates` table

## Quick Fixes Checklist

For each template in Supabase, verify:
- [ ] Max width set to `600px`
- [ ] Font sizes: 16px body, 20-24px headings
- [ ] Line height: 1.6 for body, 1.4 for headings
- [ ] Buttons: 12px 24px padding, 6-8px radius, min-height 44px
- [ ] Mobile media query reduces padding by 20%
- [ ] Colors consistent (primary: #0a2a5a, links: #1493ff)
- [ ] Spacing: 16-24px between sections, 8-12px between items

## Notes

- Templates are stored in **Supabase database**, not code
- To update: Access Supabase dashboard → `h2s_email_templates` table → Edit `html_body` column
- Test on mobile email clients (Gmail, Apple Mail, Outlook mobile)
- Use inline styles (email clients strip `<style>` tags)

