/**
 * TEST ORDER FLOW - BYPASS STRIPE PAYMENT
 * =========================================
 * Paste this at the bottom of Shopbackend.js
 * 
 * This creates a complete test order WITHOUT going through Stripe,
 * so you can test:
 * - Order creation
 * - Appointment scheduling
 * - Job creation webhook
 * - Dispatch system integration
 * 
 * USAGE:
 * ------
 * 1. Paste this code at bottom of Shopbackend.js
 * 2. Run: createTestOrder()
 * 3. Check logs for order_id and session_id
 * 4. Use the session_id to schedule appointment
 */

function createTestOrder() {
  Logger.log('========================================');
  Logger.log('CREATING TEST ORDER (NO PAYMENT)');
  Logger.log('========================================\n');
  
  try {
    // Test customer info
    const customer = {
      name: 'Test Customer',
      email: 'test@home2smart.com',
      phone: '864-555-1234'
    };
    
    // Test cart (1 TV mounting bundle)
    const cart = [{
      type: 'bundle',
      bundle_id: 'tv_single',
      name: 'Single TV Mount',
      qty: 1
    }];
    
    // Generate fake Stripe session ID
    const testSessionId = 'cs_test_' + Utilities.getUuid().substring(0, 8);
    const orderId = 'ord_test_' + new Date().getTime();
    
    Logger.log('📦 Creating test order...');
    Logger.log('Customer: ' + customer.name + ' (' + customer.email + ')');
    Logger.log('Cart: ' + cart.length + ' item(s)');
    Logger.log('Session ID: ' + testSessionId);
    Logger.log('Order ID: ' + orderId);
    
    // Create user if doesn't exist
    let user = getUserByEmail_(customer.email);
    if (!user) {
      Logger.log('👤 Creating test user...');
      createUser_({
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        password: 'Test123!'
      });
      user = getUserByEmail_(customer.email);
    } else {
      Logger.log('👤 Using existing user');
    }
    
    // Write to Orders sheet
    Logger.log('💾 Writing to Orders sheet...');
    const ordersSheet = getOrdersSheet_();
    
    // Check what columns exist
    const headers = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
    Logger.log('Available columns: ' + headers.join(', '));
    
    const now = new Date();
    
    // Build order row with all required fields for job creation
    const orderData = {
      timestamp: now,
      session_id: testSessionId,
      order_id: orderId,
      status: 'completed',
      customer_email: customer.email,
      customer_name: customer.name,
      customer_phone: customer.phone,
      service_address: '123 Test Street',
      service_city: 'Greenville',
      service_state: 'SC',
      service_zip: '29601',
      item_name: cart[0].name,
      product_id: cart[0].bundle_id,
      bundle_id: cart[0].bundle_id,
      product_type: 'bundle',
      service_id: 'tv_mounting',  // CRITICAL: Need this for job creation
      variant_code: 'single',     // CRITICAL: Need this for job creation
      qty: 1,
      subtotal: 0,
      tax: 0,
      total: 0,
      promo_code: '',
      discount: 0,
      payment_method: 'TEST',
      payment_intent_id: '',
      cart_json: JSON.stringify(cart),
      notes: 'Test order - no payment',
      created_at: now,
      updated_at: now
    };
    
    // Map to column order (assuming standard order)
    const orderRow = headers.map(function(colName) {
      return orderData[colName] !== undefined ? orderData[colName] : '';
    });
    
    ordersSheet.appendRow(orderRow);
    
    Logger.log('\n========================================');
    Logger.log('✅ TEST ORDER CREATED!');
    Logger.log('========================================');
    Logger.log('Order ID: ' + orderId);
    Logger.log('Session ID: ' + testSessionId);
    Logger.log('Customer: ' + customer.email);
    Logger.log('\n📋 NEXT STEPS:');
    Logger.log('1. Run: scheduleTestAppointment("' + testSessionId + '")');
    Logger.log('2. This will create appointment + trigger job creation');
    Logger.log('3. Check Operations sheet for new job');
    
    return {
      success: true,
      order_id: orderId,
      session_id: testSessionId,
      customer: customer.email,
      next_step: 'Run scheduleTestAppointment("' + testSessionId + '")'
    };
    
  } catch(err) {
    Logger.log('❌ ERROR: ' + err);
    Logger.log(err.stack);
    return { success: false, error: String(err) };
  }
}

/**
 * STEP 2: Schedule appointment for test order
 * This triggers the job creation webhook
 */
function scheduleTestAppointment(sessionId) {
  Logger.log('========================================');
  Logger.log('SCHEDULING TEST APPOINTMENT');
  Logger.log('========================================\n');
  
  if (!sessionId) {
    Logger.log('❌ ERROR: No session_id provided');
    Logger.log('Usage: scheduleTestAppointment("cs_test_abc123")');
    return { success: false, error: 'Missing session_id' };
  }
  
  try {
    // Get order info
    const ordersSheet = getOrdersSheet_();
    const rows = ordersSheet.getDataRange().getValues();
    const headers = rows[0];
    
    let orderRow = null;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === sessionId) { // session_id is column B
        orderRow = rows[i];
        break;
      }
    }
    
    if (!orderRow) {
      Logger.log('❌ Order not found for session: ' + sessionId);
      return { success: false, error: 'Order not found' };
    }
    
    const customerEmail = orderRow[4]; // email column
    const orderId = orderRow[2]; // order_id column
    
    Logger.log('Found order: ' + orderId);
    Logger.log('Customer: ' + customerEmail);
    
    // Create appointment (tomorrow at 10 AM)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    
    const endTime = new Date(tomorrow);
    endTime.setHours(12, 0, 0, 0); // 2 hour window
    
    const appointmentData = {
      email: customerEmail,
      order_id: orderId,
      session_id: sessionId,
      start_iso: tomorrow.toISOString(),
      end_iso: endTime.toISOString(),
      timezone: 'America/New_York',
      source: 'test_flow',
      meta: JSON.stringify({
        test: true,
        service: 'TV Mount',
        notes: 'Test appointment for job creation testing'
      })
    };
    
    Logger.log('\n📅 Creating appointment...');
    Logger.log('Start: ' + tomorrow.toISOString());
    Logger.log('End: ' + endTime.toISOString());
    
    // Call the appointment creation function
    const result = upsertAppointment_(appointmentData);
    
    if (result.ok) {
      Logger.log('\n========================================');
      Logger.log('✅ APPOINTMENT CREATED!');
      Logger.log('========================================');
      Logger.log('Appointment ID: ' + result.appointment_id);
      Logger.log('Order ID: ' + orderId);
      Logger.log('Start: ' + tomorrow.toLocaleString());
      Logger.log('\n🎯 WHAT HAPPENS NEXT:');
      Logger.log('1. Appointment saved to Appointments sheet');
      Logger.log('2. Webhook triggered to Operations backend');
      Logger.log('3. Job should be created in Operations sheet');
      Logger.log('4. Check Operations sheet for new job record');
      Logger.log('\n🔍 VERIFY:');
      Logger.log('Open: https://docs.google.com/spreadsheets/d/YOUR_OPERATIONS_SHEET_ID');
      Logger.log('Look for job with order_id: ' + orderId);
      
      return {
        success: true,
        appointment_id: result.appointment_id,
        order_id: orderId,
        session_id: sessionId,
        start_time: tomorrow.toISOString(),
        job_webhook_triggered: result.job_created || false
      };
    } else {
      Logger.log('\n❌ APPOINTMENT CREATION FAILED');
      Logger.log('Error: ' + (result.error || 'Unknown error'));
      return result;
    }
    
  } catch(err) {
    Logger.log('❌ ERROR: ' + err);
    Logger.log(err.stack);
    return { success: false, error: String(err) };
  }
}

/**
 * COMPLETE TEST FLOW - Run everything in one shot
 */
function runCompleteTestFlow() {
  Logger.log('========================================');
  Logger.log('COMPLETE TEST FLOW - ORDER → APPOINTMENT → JOB');
  Logger.log('========================================\n');
  
  // Step 1: Create test order
  const orderResult = createTestOrder();
  
  if (!orderResult.success) {
    Logger.log('\n❌ Order creation failed, stopping');
    return orderResult;
  }
  
  Logger.log('\n⏱️  Waiting 2 seconds before scheduling appointment...\n');
  Utilities.sleep(2000);
  
  // Step 2: Schedule appointment
  const apptResult = scheduleTestAppointment(orderResult.session_id);
  
  if (!apptResult.success) {
    Logger.log('\n❌ Appointment scheduling failed');
    return apptResult;
  }
  
  Logger.log('\n========================================');
  Logger.log('✅ COMPLETE TEST FLOW FINISHED!');
  Logger.log('========================================');
  Logger.log('Order ID: ' + orderResult.order_id);
  Logger.log('Session ID: ' + orderResult.session_id);
  Logger.log('Appointment ID: ' + apptResult.appointment_id);
  Logger.log('\n🎯 NOW CHECK:');
  Logger.log('1. Orders sheet - test order should be there');
  Logger.log('2. Appointments sheet - appointment should be scheduled');
  Logger.log('3. Operations sheet - job should be created');
  Logger.log('4. Check Jobs tab for job record with order_id: ' + orderResult.order_id);
  
  return {
    success: true,
    order: orderResult,
    appointment: apptResult
  };
}

/**
 * CLEANUP: Delete test data
 */
function deleteTestData() {
  Logger.log('Cleaning up test data...');
  
  try {
    const ordersSheet = getOrdersSheet_();
    const rows = ordersSheet.getDataRange().getValues();
    
    let deleted = 0;
    for (let i = rows.length - 1; i >= 1; i--) {
      const sessionId = rows[i][1];
      if (sessionId && sessionId.startsWith('cs_test_')) {
        ordersSheet.deleteRow(i + 1);
        deleted++;
      }
    }
    
    Logger.log('✅ Deleted ' + deleted + ' test orders');
    
    return { success: true, deleted: deleted };
    
  } catch(err) {
    Logger.log('❌ ERROR: ' + err);
    return { success: false, error: String(err) };
  }
}
