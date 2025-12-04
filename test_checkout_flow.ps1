# TEST COMPLETE CHECKOUT FLOW
# ============================
# This simulates a Stripe webhook event to test the autonomous flow

$webhookUrl = "https://h2s-backend.vercel.app/api/stripe-webhook"
$secret = "whsec_hINCPN8OHdM2OpOLtpstWLe5lTSdKEv3"

Write-Host "Testing Stripe Webhook Flow" -ForegroundColor Cyan
Write-Host "============================`n" -ForegroundColor Cyan

# Create a test event payload
$timestamp = [int][double]::Parse((Get-Date -UFormat %s))
$payload = @{
    id = "evt_test_$(Get-Random)"
    object = "event"
    type = "checkout.session.completed"
    created = $timestamp
    data = @{
        object = @{
            id = "cs_test_$(Get-Random)"
            object = "checkout.session"
            amount_subtotal = 81600  # $816.00
            amount_total = 88128     # $881.28
            customer_email = "test@example.com"
            payment_intent = "pi_test_$(Get-Random)"
            payment_status = "paid"
            metadata = @{
                customer_name = "Test Customer"
                customer_phone = "1234567890"
                service_address = "117 king cir"
                service_city = "greenwood"
                service_state = "SC"
                service_zip = "29649"
            }
        }
    }
} | ConvertTo-Json -Depth 10

# Create signature
$payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$secretBytes = [System.Text.Encoding]::UTF8.GetBytes($secret)
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = $secretBytes
$hash = $hmac.ComputeHash($payloadBytes)
$signature = [System.BitConverter]::ToString($hash).Replace("-", "").ToLower()

$stripeSignature = "t=$timestamp,v1=$signature"

Write-Host "Sending webhook event..." -ForegroundColor Yellow
Write-Host "Endpoint: $webhookUrl" -ForegroundColor White
Write-Host "Event Type: checkout.session.completed" -ForegroundColor White
Write-Host "Amount: $816.00 (subtotal) / $881.28 (total)" -ForegroundColor White
Write-Host "`n"

try {
    $headers = @{
        "Stripe-Signature" = $stripeSignature
        "Content-Type" = "application/json"
    }
    
    $response = Invoke-RestMethod -Uri $webhookUrl -Method POST -Headers $headers -Body $payload -ErrorAction Stop
    
    Write-Host "SUCCESS!" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json -Depth 3)" -ForegroundColor Green
    
} catch {
    Write-Host "FAILED!" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response Body: $responseBody" -ForegroundColor Yellow
    }
}

Write-Host "`n"
Write-Host "Next: Run VERIFY_SYSTEM_READY.sql in Supabase to check if job was created" -ForegroundColor Cyan
