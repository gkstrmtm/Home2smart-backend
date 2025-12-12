/**
 * CREATE TEST COUPON - 100% OFF FOR TESTING
 * ==========================================
 * Paste this at the bottom of Shopbackend.js
 * Then run createTestCoupon() in Apps Script editor
 * 
 * This creates a Stripe coupon code you can use during checkout
 * to test the full flow without paying anything.
 */

function createTestCoupon() {
  Logger.log('========================================');
  Logger.log('CREATING 100% OFF TEST COUPON');
  Logger.log('========================================\n');
  
  try {
    const stripeKey = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
    
    if (!stripeKey) {
      Logger.log('❌ ERROR: STRIPE_SECRET_KEY not found in Script Properties');
      Logger.log('Set it in: Project Settings → Script Properties');
      return { success: false, error: 'No Stripe key configured' };
    }
    
    // Create 100% off coupon
    const couponPayload = {
      'percent_off': 100,
      'duration': 'once',
      'name': 'TEST - 100% Off'
    };
    
    Logger.log('📤 Creating coupon in Stripe...');
    
    const couponRes = UrlFetchApp.fetch('https://api.stripe.com/v1/coupons', {
      method: 'post',
      headers: { 
        'Authorization': 'Bearer ' + stripeKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: couponPayload,
      muteHttpExceptions: true
    });
    
    const couponCode = couponRes.getResponseCode();
    const couponBody = couponRes.getContentText();
    
    if (couponCode !== 200) {
      Logger.log('❌ Stripe API error:');
      Logger.log(couponBody);
      return { success: false, error: couponBody };
    }
    
    const coupon = JSON.parse(couponBody);
    Logger.log('✅ Coupon created: ' + coupon.id);
    
    // Now create promotion code with human-readable code
    const promoPayload = {
      'coupon': coupon.id,
      'code': 'TEST100'
    };
    
    Logger.log('📤 Creating promotion code TEST100...');
    
    const promoRes = UrlFetchApp.fetch('https://api.stripe.com/v1/promotion_codes', {
      method: 'post',
      headers: { 
        'Authorization': 'Bearer ' + stripeKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      payload: promoPayload,
      muteHttpExceptions: true
    });
    
    const promoCode = promoRes.getResponseCode();
    const promoBody = promoRes.getContentText();
    
    if (promoCode !== 200) {
      Logger.log('⚠️  Promotion code error (coupon still created):');
      Logger.log(promoBody);
      
      // If code already exists, that's fine
      if (promoBody.indexOf('already exists') > -1) {
        Logger.log('ℹ️  Code TEST100 already exists - you can use it now');
      }
    } else {
      const promo = JSON.parse(promoBody);
      Logger.log('✅ Promotion code created: ' + promo.code);
    }
    
    Logger.log('\n========================================');
    Logger.log('✅ TEST COUPON READY!');
    Logger.log('========================================');
    Logger.log('Coupon ID: ' + coupon.id);
    Logger.log('Promo Code: TEST100');
    Logger.log('Discount: 100% off (first payment)');
    Logger.log('\n🧪 HOW TO USE:');
    Logger.log('1. Go through checkout on your site');
    Logger.log('2. When prompted for promo code, enter: TEST100');
    Logger.log('3. Order total should become $0.00');
    Logger.log('4. Complete checkout to test the full flow');
    Logger.log('\n💡 TIP: Check Stripe Dashboard → Coupons to see it');
    
    return {
      success: true,
      coupon_id: coupon.id,
      promo_code: 'TEST100',
      discount: '100%'
    };
    
  } catch(err) {
    Logger.log('❌ ERROR: ' + err);
    return { success: false, error: String(err) };
  }
}

/**
 * DELETE TEST COUPON (cleanup after testing)
 */
function deleteTestCoupon() {
  Logger.log('Deleting test coupon...');
  
  try {
    const stripeKey = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
    
    // First delete promotion code
    try {
      UrlFetchApp.fetch('https://api.stripe.com/v1/promotion_codes/promo_TEST100', {
        method: 'delete',
        headers: { 'Authorization': 'Bearer ' + stripeKey },
        muteHttpExceptions: true
      });
      Logger.log('✅ Deleted promotion code');
    } catch(e) {
      Logger.log('⚠️  Could not delete promotion code (may not exist)');
    }
    
    // Get all coupons and find ours
    const listRes = UrlFetchApp.fetch('https://api.stripe.com/v1/coupons?limit=100', {
      headers: { 'Authorization': 'Bearer ' + stripeKey }
    });
    
    const coupons = JSON.parse(listRes.getContentText());
    const testCoupon = coupons.data.find(c => c.name === 'TEST - 100% Off');
    
    if (testCoupon) {
      UrlFetchApp.fetch('https://api.stripe.com/v1/coupons/' + testCoupon.id, {
        method: 'delete',
        headers: { 'Authorization': 'Bearer ' + stripeKey }
      });
      Logger.log('✅ Deleted coupon: ' + testCoupon.id);
    } else {
      Logger.log('ℹ️  No test coupon found');
    }
    
    return { success: true };
    
  } catch(err) {
    Logger.log('❌ ERROR: ' + err);
    return { success: false, error: String(err) };
  }
}

/**
 * LIST ALL COUPONS (see what's in your Stripe account)
 */
function listAllCoupons() {
  try {
    const stripeKey = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
    
    const res = UrlFetchApp.fetch('https://api.stripe.com/v1/coupons?limit=100', {
      headers: { 'Authorization': 'Bearer ' + stripeKey }
    });
    
    const data = JSON.parse(res.getContentText());
    
    Logger.log('========================================');
    Logger.log('STRIPE COUPONS (' + data.data.length + ' total)');
    Logger.log('========================================\n');
    
    data.data.forEach(function(coupon, i) {
      Logger.log((i + 1) + '. ' + coupon.id);
      Logger.log('   Name: ' + (coupon.name || 'N/A'));
      Logger.log('   Discount: ' + (coupon.percent_off ? coupon.percent_off + '%' : '$' + (coupon.amount_off / 100)));
      Logger.log('   Valid: ' + coupon.valid);
      Logger.log('   Redeemed: ' + coupon.times_redeemed + ' times\n');
    });
    
    return data.data;
    
  } catch(err) {
    Logger.log('❌ ERROR: ' + err);
    return [];
  }
}
