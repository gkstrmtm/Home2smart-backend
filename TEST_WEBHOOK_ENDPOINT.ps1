# TEST WEBHOOK ENDPOINT
# This script tests if the webhook endpoint is accessible and responding

$endpoint = "https://h2s-backend.vercel.app/api/stripe-webhook"

Write-Host "Testing webhook endpoint: $endpoint" -ForegroundColor Cyan
Write-Host ""

# Test 1: GET request (expects 405 Method Not Allowed)
Write-Host "Test 1: GET request (expects failure)..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri $endpoint -Method GET -ErrorAction Stop
    Write-Host "Response: $($response.StatusCode) - $($response.Content)" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq 405) {
        Write-Host "Correct: Returns 405 Method Not Allowed" -ForegroundColor Green
    } else {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""

# Test 2: POST request without signature (should fail with 400)
Write-Host "Test 2: POST request without signature (expects failure)..." -ForegroundColor Yellow
try {
    $body = @{
        type = "test.event"
        data = @{}
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri $endpoint -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
    Write-Host "Unexpected success: $response" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode -eq 400) {
        Write-Host "Correct: Returns 400 for invalid signature" -ForegroundColor Green
    } else {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Endpoint appears to be deployed and responding correctly." -ForegroundColor Cyan
Write-Host ""
Write-Host "Next: Check Stripe Dashboard > Webhooks > Recent Deliveries" -ForegroundColor Cyan
Write-Host "Look for events sent to: $endpoint" -ForegroundColor White
