/**
 * SIMPLE_SET_CREDENTIALS - No database needed
 * Just sets login in Script Properties
 * 
 * INSTRUCTIONS:
 * 1. Change EMAIL and PASSWORD below
 * 2. Run this function
 * 3. Login immediately
 */

function SIMPLE_SET_CREDENTIALS() {
  
  // ========== CHANGE THESE VALUES ==========
  var EMAIL = 'h2sbackend@gmail.com';
  var PASSWORD = 'Richard.69';
  // =========================================
  
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('DISPATCH_EMAIL', EMAIL);
    props.setProperty('DISPATCH_PASSWORD', PASSWORD);
    
    Logger.log('✓ Credentials set in Script Properties');
    Logger.log('Email: ' + EMAIL);
    Logger.log('Password: ' + PASSWORD);
    
    // Test login
    var loginResult = handleLogin({email: EMAIL, password: PASSWORD});
    
    if (loginResult.ok) {
      Logger.log('✓✓✓ LOGIN TEST PASSED!');
      Logger.log('You can now login to the dashboard');
      return {ok: true, message: 'Ready to login'};
    } else {
      Logger.log('Login test failed: ' + loginResult.error);
      return {ok: false, error: loginResult.error};
    }
    
  } catch(err) {
    Logger.log('ERROR: ' + err.toString());
    return {ok: false, error: err.toString()};
  }
}
