/**
 * SET_CREDENTIALS - Run this ONCE to set your dispatch login
 * 
 * INSTRUCTIONS:
 * 1. Change EMAIL and PASSWORD below to whatever you want
 * 2. Select this function from dropdown in Apps Script editor
 * 3. Click RUN
 * 4. Check logs - should say "✓ Credentials set successfully"
 * 5. Delete this function after running (or leave it, doesn't matter)
 */

function SET_CREDENTIALS() {
  
  // ========== CHANGE THESE VALUES ==========
  var EMAIL = 'h2sbackend@gmail.com';     // Your login email
  var PASSWORD = 'Richard.69';              // Your login password
  var ROLE = 'admin';                         // Role: admin, dispatcher, or viewer
  // =========================================
  
  try {
    Logger.log('Setting credentials for: ' + EMAIL);
    
    // Check if user already exists
    var existingUsers = readAll('h2s_dispatch_users');
    var userExists = existingUsers.some(function(u) {
      return String(u.email).toLowerCase() === EMAIL.toLowerCase();
    });
    
    if (userExists) {
      // Update existing user
      Logger.log('User exists - updating password...');
      updateRow('h2s_dispatch_users', 
        {email: EMAIL}, 
        {
          password_hash: PASSWORD,
          role: ROLE,
          is_active: true,
          updated_at: new Date().toISOString()
        }
      );
      Logger.log('✓ Password updated for: ' + EMAIL);
    } else {
      // Insert new user
      Logger.log('Creating new user...');
      appendRow('h2s_dispatch_users', {
        email: EMAIL,
        password_hash: PASSWORD,
        role: ROLE,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      Logger.log('✓ User created: ' + EMAIL);
    }
    
    // Test login
    Logger.log('\nTesting login...');
    var loginResult = handleLogin({email: EMAIL, password: PASSWORD});
    
    if (loginResult.ok) {
      Logger.log('✓✓✓ SUCCESS! You can now login with:');
      Logger.log('   Email: ' + EMAIL);
      Logger.log('   Password: ' + PASSWORD);
      Logger.log('   Role: ' + ROLE);
      return {
        ok: true,
        message: 'Credentials set successfully',
        email: EMAIL,
        role: ROLE,
        test_login: 'PASSED'
      };
    } else {
      Logger.log('✗ Login test failed: ' + loginResult.error);
      return {
        ok: false,
        error: 'Login test failed: ' + loginResult.error
      };
    }
    
  } catch(err) {
    Logger.log('ERROR: ' + err.toString());
    Logger.log('Stack: ' + err.stack);
    return {
      ok: false,
      error: err.toString(),
      stack: err.stack
    };
  }
}
