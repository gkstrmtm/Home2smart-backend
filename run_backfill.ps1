# Run Payout Backfill
# This script calls the Vercel endpoint and displays all logs

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "💰 PAYOUT BACKFILL - STARTING" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

# Get admin secret from environment or prompt
$adminSecret = $env:ADMIN_SECRET
if (-not $adminSecret) {
    Write-Host "⚠️  ADMIN_SECRET not found in environment" -ForegroundColor Yellow
    Write-Host "Please enter the admin secret:" -ForegroundColor White
    $adminSecret = Read-Host -AsSecureString
    $adminSecret = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecret))
}

# Call the endpoint
$endpoint = "https://h2s-backend-79yq529n5-tabari-ropers-projects-6f2e090b.vercel.app/api/backfill_payouts"
Write-Host "📡 Calling: $endpoint" -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $endpoint -Method Post -Headers @{
        "Authorization" = "Bearer $adminSecret"
        "Content-Type" = "application/json"
    } -TimeoutSec 300

    # Display all logs
    Write-Host "📋 LOGS:" -ForegroundColor Cyan
    Write-Host "----------------------------------------" -ForegroundColor Gray
    foreach ($log in $response.logs) {
        if ($log -like "*❌*" -or $log -like "*Error*") {
            Write-Host $log -ForegroundColor Red
        } elseif ($log -like "*✅*" -or $log -like "*Created*") {
            Write-Host $log -ForegroundColor Green
        } elseif ($log -like "*⚠️*" -or $log -like "*WARNING*") {
            Write-Host $log -ForegroundColor Yellow
        } elseif ($log -like "*====*") {
            Write-Host $log -ForegroundColor Cyan
        } else {
            Write-Host $log -ForegroundColor White
        }
    }
    Write-Host "----------------------------------------" -ForegroundColor Gray

    # Display summary
    Write-Host "`n📊 FINAL RESULTS:" -ForegroundColor Cyan
    Write-Host "  ✅ Created:  $($response.created)" -ForegroundColor Green
    Write-Host "  ⏭️  Skipped:  $($response.skipped)" -ForegroundColor Yellow
    Write-Host "  ❌ Errors:   $($response.errors)" -ForegroundColor Red
    
    if ($response.ok) {
        Write-Host "`n✅ BACKFILL COMPLETED SUCCESSFULLY`n" -ForegroundColor Green
    } else {
        Write-Host "`n⚠️  BACKFILL COMPLETED WITH ERRORS`n" -ForegroundColor Yellow
    }

} catch {
    Write-Host "`n❌ REQUEST FAILED" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
    
    if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-Host "`n⚠️  Authentication failed. Check your ADMIN_SECRET" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
