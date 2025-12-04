# JOB CREATION FIXES - DEPLOYMENT SCRIPT
# ========================================
# Run this after reviewing JOB_CREATION_FIXES.md

Write-Host "╔════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  JOB CREATION FIXES DEPLOYMENT         ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Step 1: Show what will be deployed
Write-Host "📋 Files Modified:" -ForegroundColor Yellow
Write-Host "  1. api/stripe-webhook.js - Store subtotal + total"
Write-Host "  2. api/create_jobs_from_orders.js - Extract metadata, fix payout"
Write-Host "  3. ADD_SUBTOTAL_TO_ORDERS.sql - Database migration"
Write-Host ""

# Step 2: Confirm deployment
$confirm = Read-Host "Ready to deploy? (y/n)"
if ($confirm -ne 'y') {
    Write-Host "❌ Deployment cancelled" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "STEP 1: Database Migration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "⚠️  MANUAL STEP REQUIRED:" -ForegroundColor Yellow
Write-Host "1. Open Supabase SQL Editor:"
Write-Host "   https://supabase.com/dashboard/project/YOUR_PROJECT_ID/sql/new"
Write-Host ""
Write-Host "2. Copy contents of ADD_SUBTOTAL_TO_ORDERS.sql"
Write-Host "3. Run the SQL migration"
Write-Host "4. Verify column added: SELECT subtotal FROM h2s_orders LIMIT 1;"
Write-Host ""

$schemaConfirm = Read-Host "Have you applied the schema migration? (y/n)"
if ($schemaConfirm -ne 'y') {
    Write-Host "⏸️  Pausing deployment - apply schema first" -ForegroundColor Yellow
    Write-Host "   Run this script again after schema migration"
    exit 0
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "STEP 2: Git Commit & Push" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Show git status
Write-Host "📊 Current Git Status:" -ForegroundColor Yellow
git status --short

Write-Host ""
$gitConfirm = Read-Host "Commit and push changes? (y/n)"
if ($gitConfirm -ne 'y') {
    Write-Host "⏸️  Skipping git commit" -ForegroundColor Yellow
    exit 0
}

# Stage changes
Write-Host ""
Write-Host "📦 Staging changes..." -ForegroundColor Green
git add api/stripe-webhook.js
git add api/create_jobs_from_orders.js
git add ADD_SUBTOTAL_TO_ORDERS.sql
git add JOB_CREATION_FIXES.md
git add test-job-creation-flow.js

# Commit
Write-Host "💾 Committing..." -ForegroundColor Green
git commit -m "Fix job creation flow: metadata extraction + fair payouts

- Extract service address from order.metadata (was expecting top-level columns)
- Calculate payout from subtotal (pre-discount) instead of total
- Add subtotal column to webhook order creation
- Ensures pros get fair 60% of original price regardless of customer promos

Fixes:
- Jobs now have correct service_address, geo_lat, geo_lng
- Payout calculation uses subtotal not discounted total
- 20% promo: pro still gets `$`359 (not `$`287)
- 50% promo: pro still gets `$`359 (not `$`179)

Files:
- api/stripe-webhook.js: Store subtotal + total
- api/create_jobs_from_orders.js: Extract metadata, use subtotal
- ADD_SUBTOTAL_TO_ORDERS.sql: Schema migration"

# Push
Write-Host "🚀 Pushing to origin..." -ForegroundColor Green
git push origin main

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "STEP 3: Verify Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "⏳ Waiting for Vercel deployment..." -ForegroundColor Yellow
Write-Host "   Check: https://vercel.com/your-project/deployments"
Write-Host ""

Start-Sleep -Seconds 5

Write-Host "✅ DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Wait for Vercel build to finish (~2 minutes)"
Write-Host "  2. Test live checkout with promo code"
Write-Host "  3. Verify job created with:"
Write-Host "     - Correct service_address, city, state, zip"
Write-Host "     - Valid geo_lat, geo_lng coordinates"
Write-Host "     - Payout = 60% of subtotal (not discounted total)"
Write-Host ""
Write-Host "🔍 Verification SQL:" -ForegroundColor Yellow
Write-Host @"
SELECT 
  o.order_id,
  o.subtotal,
  o.total,
  o.metadata->>'service_address' as address,
  j.service_address,
  j.geo_lat,
  j.geo_lng,
  j.payout_amount
FROM h2s_orders o
LEFT JOIN h2s_dispatch_jobs j ON j.metadata->>'order_id' = o.order_id
WHERE o.created_at > NOW() - INTERVAL '1 hour'
ORDER BY o.created_at DESC
LIMIT 1;
"@
Write-Host ""
Write-Host "💡 Expected Result:" -ForegroundColor Yellow
Write-Host "  - subtotal: 599 (original price)"
Write-Host "  - total: 479.20 (after 20% promo)"
Write-Host "  - address: '123 Main St' (from metadata)"
Write-Host "  - geo_lat: 34.8526, geo_lng: -82.3940 (geocoded)"
Write-Host "  - payout_amount: 359.40 (60% of subtotal, not total)"
Write-Host ""
