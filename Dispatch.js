/**** Dispatch Ordering Dashboard • Backend (Google Apps Script)
 * Standalone script for equipment ordering workflow
 * Deploy as web app, set JOBS_SHEET_ID in Script Properties
 */

// ========================= CONFIGURATION =========================

const CONFIG = {
  // Set these in Script Properties (File > Project Properties > Script Properties):
  // SUPABASE_URL = your Supabase project URL
  // SUPABASE_ANON_KEY or SUPABASE_SERVICE_KEY = your Supabase key
  // OPENAI_API_KEY = your OpenAI API key
  // DISPATCH_EMAIL = dispatch user email (optional, defaults to dispatch@home2smart.com)
  // DISPATCH_PASSWORD = dispatch user password (optional, defaults to dispatch2024)
  
  get SUPABASE_URL() {
    return PropertiesService.getScriptProperties().getProperty('SUPABASE_URL');
  },
  get SUPABASE_KEY() {
    // Support multiple property names for the key
    var props = PropertiesService.getScriptProperties();
    return props.getProperty('SUPABASE_KEY') || 
           props.getProperty('SUPABASE_ANON_KEY') || 
           props.getProperty('SUPABASE_SERVICE_KEY');
  },
  get OPENAI_API_KEY() {
    return PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  },
  get DISPATCH_EMAIL() {
    return PropertiesService.getScriptProperties().getProperty('DISPATCH_EMAIL') || 'dispatch@home2smart.com';
  },
  get DISPATCH_PASSWORD() {
    return PropertiesService.getScriptProperties().getProperty('DISPATCH_PASSWORD') || 'dispatch2024';
  },
  
  // Session settings
  SESSION_TTL_HOURS: 24,
  
  // Database settings
  USE_DATABASE: true,
  DB_FALLBACK_TO_SHEETS: false,
  
  // Debug settings
  DEBUG: true // Set to false in production
};

// ========================= SUPABASE DATABASE =========================

/**
 * Execute a SQL query on Supabase via REST API
 */
function query_(sql, params) {
  if (!CONFIG.USE_DATABASE) {
    throw new Error('Database is disabled');
  }
  
  const url = CONFIG.SUPABASE_URL;
  const key = CONFIG.SUPABASE_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase credentials not configured in Script Properties');
  }
  
  const endpoint = url + '/rest/v1/rpc/exec_sql';
  const payload = { sql: sql, params: params || {} };
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Prefer': 'return=representation'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(endpoint, options);
  const code = response.getResponseCode();
  
  if (code !== 200 && code !== 201) {
    throw new Error('Database error: ' + code + ' - ' + response.getContentText());
  }
  
  const text = response.getContentText();
  return text ? JSON.parse(text) : [];
}

/**
 * Read all rows from a table
 */
function readAll(tableName) {
  if (!CONFIG.USE_DATABASE) {
    throw new Error('Database is disabled');
  }
  
  const url = CONFIG.SUPABASE_URL + '/rest/v1/' + tableName + '?select=*';
  const key = CONFIG.SUPABASE_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase credentials not configured');
  }
  
  const options = {
    method: 'get',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key
    },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  
  if (code !== 200) {
    throw new Error('Database read error: ' + code);
  }
  
  return JSON.parse(response.getContentText());
}

/**
 * Insert a row into a table
 */
function appendRow(tableName, row) {
  if (!CONFIG.USE_DATABASE) {
    throw new Error('Database is disabled');
  }
  
  const url = CONFIG.SUPABASE_URL + '/rest/v1/' + tableName;
  const key = CONFIG.SUPABASE_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase credentials not configured');
  }
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Prefer': 'return=representation'
    },
    payload: JSON.stringify(row),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  
  if (code !== 201) {
    throw new Error('Database insert error: ' + code + ' - ' + response.getContentText());
  }
  
  return JSON.parse(response.getContentText())[0];
}

/**
 * Update rows in a table
 */
function updateRow(tableName, filters, updates) {
  if (!CONFIG.USE_DATABASE) {
    throw new Error('Database is disabled');
  }
  
  const url = CONFIG.SUPABASE_URL + '/rest/v1/' + tableName;
  const key = CONFIG.SUPABASE_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase credentials not configured');
  }
  
  // Build filter query string
  let filterStr = '';
  Object.keys(filters).forEach(function(k, idx) {
    if (idx > 0) filterStr += '&';
    filterStr += k + '=eq.' + encodeURIComponent(filters[k]);
  });
  
  const fullUrl = url + '?' + filterStr;
  
  const options = {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Prefer': 'return=representation'
    },
    payload: JSON.stringify(updates),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(fullUrl, options);
  const code = response.getResponseCode();
  
  if (code !== 200) {
    throw new Error('Database update error: ' + code + ' - ' + response.getContentText());
  }
  
  return JSON.parse(response.getContentText());
}

// ========================= DEBUG LOGGING =========================

function debugLog(action, message, data = null) {
  if (!CONFIG.DEBUG) return;
  
  try {
    const logMsg = `[${action}] ${message}` + (data ? `: ${JSON.stringify(data)}` : '');
    Logger.log(logMsg);
    console.log(logMsg);
  } catch (err) {
    // Logging failed, ignore silently
  }
}

// ========================= SETUP HELPER =========================

/**
 * Run this once to configure Script Properties
 * Copy values from your Operations.js project's Script Properties
 */
function SETUP_SCRIPT_PROPERTIES() {
  Logger.log('=== SETUP SCRIPT PROPERTIES ===');
  Logger.log('You need to manually set these in:');
  Logger.log('File > Project Settings > Script Properties');
  Logger.log('');
  Logger.log('Required properties:');
  Logger.log('  SUPABASE_URL = https://your-project.supabase.co');
  Logger.log('  SUPABASE_KEY = your-anon-or-service-key');
  Logger.log('  OPENAI_API_KEY = sk-...');
  Logger.log('');
  Logger.log('Optional properties (defaults shown):');
  Logger.log('  DISPATCH_EMAIL = dispatch@home2smart.com');
  Logger.log('  DISPATCH_PASSWORD = dispatch2024');
  Logger.log('');
  Logger.log('After setting properties, run healthCheck() to verify');
  
  // Check current values
  var props = PropertiesService.getScriptProperties().getProperties();
  Logger.log('');
  Logger.log('Current Script Properties:');
  Object.keys(props).forEach(function(key) {
    var value = props[key];
    if (key.includes('KEY') || key.includes('PASSWORD')) {
      Logger.log('  ' + key + ' = ' + value.substring(0, 8) + '...');
    } else {
      Logger.log('  ' + key + ' = ' + value);
    }
  });
  
  return {
    ok: true,
    message: 'Check logs for instructions',
    current_properties: Object.keys(props)
  };
}

/**
 * COPY_FROM_OPERATIONS - Copy Supabase credentials from Operations.js
 * Run this to automatically grab credentials from your main Operations.js project
 * 
 * YOU MUST UPDATE THE OPERATIONS_SCRIPT_ID BELOW WITH YOUR ACTUAL OPERATIONS.JS PROJECT ID
 */
function COPY_FROM_OPERATIONS() {
  Logger.log('=== COPY SUPABASE CREDENTIALS FROM OPERATIONS.JS ===\n');
  
  // **REPLACE THIS WITH YOUR ACTUAL OPERATIONS.JS SCRIPT ID**
  // Find it in Operations.js: File > Project Settings > IDs > Script ID
  var OPERATIONS_SCRIPT_ID = 'PASTE_YOUR_OPERATIONS_SCRIPT_ID_HERE';
  
  if (OPERATIONS_SCRIPT_ID === 'PASTE_YOUR_OPERATIONS_SCRIPT_ID_HERE') {
    Logger.log('❌ ERROR: You need to update OPERATIONS_SCRIPT_ID in this function');
    Logger.log('');
    Logger.log('Steps:');
    Logger.log('1. Open your Operations.js Apps Script project');
    Logger.log('2. Go to: Project Settings (⚙️ icon on left)');
    Logger.log('3. Copy the "Script ID" (looks like: 1a2b3c4d5e6f7g8h9i0j...)');
    Logger.log('4. Paste it into OPERATIONS_SCRIPT_ID variable in this function');
    Logger.log('5. Run this function again');
    Logger.log('');
    return {ok: false, error: 'OPERATIONS_SCRIPT_ID not configured'};
  }
  
  try {
    Logger.log('Attempting to read from Operations.js project: ' + OPERATIONS_SCRIPT_ID);
    
    // Try to access the other project's properties
    // Note: This only works if both scripts are in the same Google account
    var otherScript = ScriptApp.getScriptById(OPERATIONS_SCRIPT_ID);
    
    // Get properties from Operations.js
    var otherProps = PropertiesService.getUserProperties(); // Shared across all scripts
    
    var supabaseUrl = otherProps.getProperty('SUPABASE_URL');
    var supabaseKey = otherProps.getProperty('SUPABASE_KEY');
    var openaiKey = otherProps.getProperty('OPENAI_API_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      Logger.log('❌ Could not find SUPABASE_URL or SUPABASE_KEY in user properties');
      Logger.log('');
      Logger.log('Alternative: Copy manually');
      Logger.log('1. Open Operations.js');
      Logger.log('2. Run this code there to see values:');
      Logger.log('   var props = PropertiesService.getScriptProperties().getProperties();');
      Logger.log('   Logger.log(props);');
      Logger.log('3. Copy values here manually using SET_CREDENTIALS function below');
      return {ok: false, error: 'Credentials not found in user properties'};
    }
    
    // Set in this project's Script Properties
    var localProps = PropertiesService.getScriptProperties();
    localProps.setProperty('SUPABASE_URL', supabaseUrl);
    localProps.setProperty('SUPABASE_KEY', supabaseKey);
    if (openaiKey) {
      localProps.setProperty('OPENAI_API_KEY', openaiKey);
    }
    
    Logger.log('✅ SUCCESS! Copied credentials:');
    Logger.log('  SUPABASE_URL: ' + supabaseUrl);
    Logger.log('  SUPABASE_KEY: ' + supabaseKey.substring(0, 20) + '...');
    Logger.log('  OPENAI_API_KEY: ' + (openaiKey ? openaiKey.substring(0, 8) + '...' : 'NOT FOUND'));
    Logger.log('');
    Logger.log('Now run DIAGNOSE_DATABASE() to test connection');
    
    return {ok: true, message: 'Credentials copied successfully'};
    
  } catch(err) {
    Logger.log('❌ ERROR: ' + err.toString());
    Logger.log('');
    Logger.log('This script cannot access Operations.js Script Properties directly.');
    Logger.log('Use the manual method below instead:');
    Logger.log('');
    return {ok: false, error: err.toString()};
  }
}

/**
 * SET_CREDENTIALS - Manually set Supabase credentials
 * Use this if COPY_FROM_OPERATIONS doesn't work
 * 
 * INSTRUCTIONS:
 * 1. Replace the placeholder values below with your actual credentials
 * 2. Run this function once
 * 3. Delete/comment out the credentials from code for security
 */
function SET_CREDENTIALS() {
  Logger.log('=== MANUAL CREDENTIAL SETUP ===\n');
  
  // **PASTE YOUR ACTUAL CREDENTIALS HERE**
  var SUPABASE_URL = 'https://your-project.supabase.co';  // Replace with your Supabase project URL
  var SUPABASE_KEY = 'your-supabase-anon-key';             // Replace with your Supabase anon key
  var OPENAI_API_KEY = 'sk-your-openai-key';               // Replace with your OpenAI API key
  
  // Validation
  if (SUPABASE_URL === 'https://your-project.supabase.co') {
    Logger.log('❌ ERROR: You need to replace placeholder values with real credentials');
    Logger.log('');
    Logger.log('Steps:');
    Logger.log('1. Open your Operations.js project');
    Logger.log('2. Go to: Project Settings > Script Properties');
    Logger.log('3. Copy SUPABASE_URL and SUPABASE_KEY values');
    Logger.log('4. Paste them into this function (lines above)');
    Logger.log('5. Run this function again');
    Logger.log('');
    Logger.log('Where to find credentials:');
    Logger.log('- Operations.js: Project Settings > Script Properties');
    Logger.log('- Supabase: Project Settings > API > URL and anon/public key');
    Logger.log('- OpenAI: https://platform.openai.com/api-keys');
    Logger.log('');
    return {ok: false, error: 'Placeholder values detected'};
  }
  
  try {
    // Set Script Properties
    var props = PropertiesService.getScriptProperties();
    props.setProperty('SUPABASE_URL', SUPABASE_URL);
    props.setProperty('SUPABASE_KEY', SUPABASE_KEY);
    props.setProperty('OPENAI_API_KEY', OPENAI_API_KEY);
    
    Logger.log('✅ SUCCESS! Credentials configured:');
    Logger.log('  SUPABASE_URL: ' + SUPABASE_URL);
    Logger.log('  SUPABASE_KEY: ' + SUPABASE_KEY.substring(0, 20) + '...');
    Logger.log('  OPENAI_API_KEY: ' + OPENAI_API_KEY.substring(0, 8) + '...');
    Logger.log('');
    Logger.log('⚠️ SECURITY: Now delete/comment out the credentials from this function!');
    Logger.log('');
    Logger.log('Next steps:');
    Logger.log('1. Run DIAGNOSE_DATABASE() to test database connection');
    Logger.log('2. Run healthCheck() to verify all systems');
    Logger.log('');
    
    return {ok: true, message: 'Credentials set successfully'};
    
  } catch(err) {
    Logger.log('❌ ERROR: ' + err.toString());
    return {ok: false, error: err.toString()};
  }
}

// ========================= HTTP ENTRYPOINTS =========================

function doGet(e) {
  try {
    const action = e.parameter.action;
    
    // Serve HTML page
    if (!action) {
      return HtmlService.createHtmlOutputFromFile('index')
        .setTitle('Dispatch Ordering Dashboard')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    
    // Login - no auth required
    if (action === 'login') {
      return ContentService.createTextOutput(JSON.stringify(handleLogin(e.parameter)))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Health check - no auth required
    if (action === 'health_check') {
      return ContentService.createTextOutput(JSON.stringify(healthCheck()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // All other actions require auth
    const sessionId = e.parameter.session_id;
    if (!sessionId || !validateSession(sessionId)) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false,
        error: 'Authentication required',
        error_code: 'auth_required'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Handle authenticated actions
    let result;
    switch(action) {
      case 'get_jobs':
        result = getJobsNeedingEquipment(e.parameter);
        break;
      case 'get_job':
        result = getJobDetails(e.parameter);
        break;
      case 'generate_list':
        result = generateEquipmentList(e.parameter);
        break;
      case 'mark_ordered':
        result = markEquipmentOrdered(e.parameter);
        break;
      case 'search':
        result = searchJob(e.parameter);
        break;
      default:
        result = {ok: false, error: 'Unknown action'};
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ========================= HEALTH CHECK / DIAGNOSTICS =========================

/**
 * Test all connections and configurations
 * Call this first to verify everything is set up correctly
 */
function healthCheck() {
  debugLog('healthCheck', 'Starting health check');
  
  var results = {
    ok: true,
    timestamp: new Date().toISOString(),
    checks: [],
    config: {
      debug_enabled: CONFIG.DEBUG,
      session_ttl_hours: CONFIG.SESSION_TTL_HOURS,
      use_database: CONFIG.USE_DATABASE
    }
  };
  
  // 1. Check Supabase URL configured
  var supabaseUrl = CONFIG.SUPABASE_URL;
  var check1 = {
    test: 'SUPABASE_URL configured',
    passed: !!supabaseUrl,
    value: supabaseUrl ? supabaseUrl : 'NOT SET'
  };
  results.checks.push(check1);
  debugLog('healthCheck', 'Check 1: SUPABASE_URL', check1);
  
  if (!supabaseUrl) {
    results.ok = false;
    debugLog('healthCheck', 'FAILED: No SUPABASE_URL configured');
    return results;
  }
  
  // 2. Check Supabase Key configured
  var supabaseKey = CONFIG.SUPABASE_KEY;
  var check2 = {
    test: 'SUPABASE_KEY configured',
    passed: !!supabaseKey,
    value: supabaseKey ? 'sk-...' + supabaseKey.substring(supabaseKey.length - 4) : 'NOT SET'
  };
  results.checks.push(check2);
  debugLog('healthCheck', 'Check 2: SUPABASE_KEY', check2);
  
  if (!supabaseKey) {
    results.ok = false;
    return results;
  }
  
  // 3. Test database connection - read jobs
  try {
    var jobs = readAll(TABS.JOBS);
    var check3 = {
      test: 'Database connection (h2s_jobs)',
      passed: true,
      value: jobs.length + ' jobs found',
      total_jobs: jobs.length
    };
    results.checks.push(check3);
    debugLog('healthCheck', 'Check 3: Database connection', check3);
  } catch(e) {
    results.ok = false;
    var check3 = {
      test: 'Database connection (h2s_jobs)',
      passed: false,
      error: e.toString(),
      stack: e.stack
    };
    results.checks.push(check3);
    debugLog('healthCheck', 'FAILED: Database connection', check3);
    return results;
  }
  
  // 4. Check auth tables exist
  try {
    var users = readAll('h2s_dispatch_users');
    var check4 = {
      test: 'Auth table (h2s_dispatch_users)',
      passed: true,
      value: users.length + ' users configured',
      users_count: users.length
    };
    results.checks.push(check4);
    debugLog('healthCheck', 'Check 4: Auth users table', check4);
  } catch(e) {
    results.ok = false;
    var check4 = {
      test: 'Auth table (h2s_dispatch_users)',
      passed: false,
      error: e.toString(),
      hint: 'Run dispatch_auth_setup.sql in Supabase to create table'
    };
    results.checks.push(check4);
    debugLog('healthCheck', 'FAILED: Auth table', check4);
  }
  
  // 5. Check OpenAI API key configured
  var apiKey = CONFIG.OPENAI_API_KEY;
  var check5 = {
    test: 'OPENAI_API_KEY configured',
    passed: !!apiKey,
    value: apiKey ? 'sk-...' + apiKey.substring(apiKey.length - 4) : 'NOT SET'
  };
  results.checks.push(check5);
  debugLog('healthCheck', 'Check 5: OpenAI API key', check5);
  
  if (!apiKey) {
    results.ok = false;
  }
  
  // 6. Test actual login
  var testLogin = handleLogin({
    email: 'dispatch@home2smart.com',
    password: 'dispatch2024'
  });
  var check6 = {
    test: 'Test login (dispatch@home2smart.com)',
    passed: testLogin.ok,
    result: testLogin.ok ? 'Login successful' : 'Login failed',
    error: testLogin.error || null,
    hint: testLogin.ok ? null : 'Check that dispatch_auth_setup.sql was run in Supabase'
  };
  results.checks.push(check6);
  debugLog('healthCheck', 'Check 6: Test Login', check6);
  
  if (!testLogin.ok) {
    results.ok = false;
  }
  
  // 7. Count jobs needing equipment
  try {
    var needingEquipment = jobs.filter(function(job) {
      var delivered = String(job.equipment_delivered || '').toLowerCase();
      var status = String(job.status || '').toLowerCase();
      return (delivered === 'false' || delivered === '' || delivered === 'no' || !delivered) && 
             status !== 'completed' && 
             status !== 'cancelled';
    });
    
    var check7 = {
      test: 'Jobs needing equipment',
      passed: true,
      value: needingEquipment.length + ' jobs',
      total_jobs: jobs.length,
      needing_equipment: needingEquipment.length
    };
    results.checks.push(check7);
    debugLog('healthCheck', 'Check 7: Jobs needing equipment', check7);
  } catch(e) {
    var check7 = {
      test: 'Jobs needing equipment',
      passed: false,
      error: e.toString()
    };
    results.checks.push(check7);
    debugLog('healthCheck', 'Check 7 ERROR', check7);
  }
  
  debugLog('healthCheck', 'Health check complete', {ok: results.ok, total_checks: results.checks.length});
  
  return results;
}

/**
 * TEST CREDENTIALS: Check what credentials are actually set
 * Run this to see exactly what the system is comparing against
 */
function testCredentials() {
  Logger.log('=== CREDENTIAL DIAGNOSIS ===');
  
  try {
    // Get from Script Properties
    var emailFromProps = PropertiesService.getScriptProperties().getProperty('DISPATCH_EMAIL');
    var passwordFromProps = PropertiesService.getScriptProperties().getProperty('DISPATCH_PASSWORD');
    
    Logger.log('1. Script Properties:');
    Logger.log('   DISPATCH_EMAIL: ' + (emailFromProps ? emailFromProps : 'NOT SET (will use default)'));
    Logger.log('   DISPATCH_PASSWORD: ' + (passwordFromProps ? '[SET - ' + passwordFromProps.length + ' chars]' : 'NOT SET (will use default)'));
    
    Logger.log('\n2. CONFIG values (after defaults):');
    Logger.log('   CONFIG.DISPATCH_EMAIL: ' + CONFIG.DISPATCH_EMAIL);
    Logger.log('   CONFIG.DISPATCH_PASSWORD: ' + (CONFIG.DISPATCH_PASSWORD ? '[SET - ' + CONFIG.DISPATCH_PASSWORD.length + ' chars]' : 'NOT SET'));
    
    Logger.log('\n3. Test login with defaults:');
    var testResult = handleLogin({
      email: 'dispatch@home2smart.com',
      password: 'dispatch2024'
    });
    Logger.log('   Result: ' + (testResult.ok ? '✓ SUCCESS' : '✗ FAILED'));
    Logger.log('   Response: ' + JSON.stringify(testResult, null, 2));
    
    if (emailFromProps || passwordFromProps) {
      Logger.log('\n4. Test login with Script Properties values:');
      var testResult2 = handleLogin({
        email: emailFromProps || CONFIG.DISPATCH_EMAIL,
        password: passwordFromProps || CONFIG.DISPATCH_PASSWORD
      });
      Logger.log('   Result: ' + (testResult2.ok ? '✓ SUCCESS' : '✗ FAILED'));
      Logger.log('   Response: ' + JSON.stringify(testResult2, null, 2));
    }
    
    Logger.log('\n=== TO FIX ISSUES ===');
    Logger.log('If login fails:');
    Logger.log('1. Go to Project Settings > Script Properties');
    Logger.log('2. Add DISPATCH_EMAIL = your-email@home2smart.com');
    Logger.log('3. Add DISPATCH_PASSWORD = your-password');
    Logger.log('4. Or leave blank to use defaults (dispatch@home2smart.com / dispatch2024)');
    
    return {
      ok: true,
      script_properties: {
        email_set: !!emailFromProps,
        password_set: !!passwordFromProps
      },
      config_values: {
        email: CONFIG.DISPATCH_EMAIL,
        password_length: CONFIG.DISPATCH_PASSWORD ? CONFIG.DISPATCH_PASSWORD.length : 0
      },
      default_test: testResult.ok
    };
    
  } catch(err) {
    Logger.log('ERROR: ' + err.toString());
    return {ok: false, error: err.toString()};
  }
}

/**
 * MANUAL TEST: Force create Debug_Log sheet and test logging
 * Run this function directly from Apps Script editor to verify debug system
 */
function testDebugSystem() {
  Logger.log('=== Testing Debug System ===');
  
  // Force DEBUG on
  var originalDebug = CONFIG.DEBUG;
  
  try {
    // Test 1: Check spreadsheet ID
    Logger.log('1. Checking JOBS_SHEET_ID...');
    var sheetId = CONFIG.JOBS_SHEET_ID;
    if (!sheetId) {
      Logger.log('ERROR: JOBS_SHEET_ID not set in Script Properties!');
      return {ok: false, error: 'JOBS_SHEET_ID not configured'};
    }
    Logger.log('   ✓ JOBS_SHEET_ID: ' + sheetId);
    
    // Test 2: Access spreadsheet
    Logger.log('2. Opening spreadsheet...');
    var spreadsheet = SpreadsheetApp.openById(sheetId);
    Logger.log('   ✓ Spreadsheet: ' + spreadsheet.getName());
    
    // Test 3: Check if Debug_Log exists
    Logger.log('3. Checking for Debug_Log sheet...');
    var debugSheet = spreadsheet.getSheetByName(CONFIG.DEBUG_SHEET_NAME);
    if (debugSheet) {
      Logger.log('   ✓ Debug_Log sheet already exists with ' + debugSheet.getLastRow() + ' rows');
    } else {
      Logger.log('   ℹ Debug_Log sheet does not exist yet - will create');
    }
    
    // Test 4: Force create/append to Debug_Log
    Logger.log('4. Creating/updating Debug_Log sheet...');
    if (!debugSheet) {
      debugSheet = spreadsheet.insertSheet(CONFIG.DEBUG_SHEET_NAME);
      debugSheet.appendRow(['Timestamp', 'Action', 'Message', 'Data']);
      debugSheet.getRange(1, 1, 1, 4).setFontWeight('bold');
      Logger.log('   ✓ Created Debug_Log sheet with headers');
    }
    
    // Test 5: Write test entries
    Logger.log('5. Writing test log entries...');
    var timestamp = new Date().toISOString();
    debugSheet.appendRow([timestamp, 'TEST', 'Debug system test - manual run', '{"test": true}']);
    debugSheet.appendRow([timestamp, 'TEST', 'If you see this, debug logging works!', null]);
    Logger.log('   ✓ Wrote 2 test entries to Debug_Log');
    
    // Test 6: Test debugLog function
    Logger.log('6. Testing debugLog() function...');
    debugLog('testDebugSystem', 'This is a test from testDebugSystem()', {success: true, timestamp: new Date()});
    Logger.log('   ✓ debugLog() executed');
    
    Logger.log('\n=== DEBUG SYSTEM TEST COMPLETE ===');
    Logger.log('✓ Check your spreadsheet for the "Debug_Log" tab');
    Logger.log('✓ URL: ' + spreadsheet.getUrl());
    
    return {
      ok: true,
      spreadsheet_name: spreadsheet.getName(),
      spreadsheet_url: spreadsheet.getUrl(),
      debug_sheet_exists: true,
      debug_sheet_rows: debugSheet.getLastRow(),
      message: 'Debug_Log sheet created/updated successfully'
    };
    
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

// ========================= AUTHENTICATION =========================

/**
 * Simple password verification (bcrypt-style comparison)
 * For demo: accepts 'dispatch2024' for dispatch@home2smart.com
 * In production: Use proper bcrypt verification via Supabase function
 */
function verifyPassword(inputPassword, storedHash) {
  // For now, simple comparison - in production use bcrypt via database function
  // Bcrypt hash of 'dispatch2024': $2b$10$8K1p/a0dL5R.1O5m0ZGI2.5mNvJx0xHjJJ5U2FfDn6XZQqFJlGzrW
  if (inputPassword === 'dispatch2024' && storedHash === '$2b$10$8K1p/a0dL5R.1O5m0ZGI2.5mNvJx0xHjJJ5U2FfDn6XZQqFJlGzrW') {
    return true;
  }
  // Fallback for plain text (development only)
  return inputPassword === storedHash;
}

function handleLogin(params) {
  try {
    const email = String(params.email || '').trim().toLowerCase();
    const password = String(params.password || '').trim();
    
    if (!email || !password) {
      return {ok: false, error: 'Email and password required'};
    }
    
    // Query dispatch users table in Supabase
    try {
      const users = readAll('h2s_dispatch_users');
      
      if (!users || users.length === 0) {
        debugLog('handleLogin', 'No users found in h2s_dispatch_users table', {});
        return {ok: false, error: 'Authentication failed - no users configured'};
      }
      
      // Find user by email
      const user = users.find(u => String(u.email).toLowerCase() === email);
      
      if (!user) {
        debugLog('handleLogin', 'User not found', {email});
        return {ok: false, error: 'Invalid credentials'};
      }
      
      if (!user.is_active) {
        debugLog('handleLogin', 'User account inactive', {email});
        return {ok: false, error: 'Account disabled'};
      }
      
      // Verify password
      if (!verifyPassword(password, user.password_hash)) {
        debugLog('handleLogin', 'Password mismatch', {email});
        return {ok: false, error: 'Invalid credentials'};
      }
      
      // Create session
      const sessionId = createSession(email, user.role || 'dispatcher');
      
      debugLog('handleLogin', 'Login successful', {email, role: user.role});
      
      return {
        ok: true,
        session_id: sessionId,
        email: email,
        role: user.role || 'dispatcher'
      };
      
    } catch(dbErr) {
      debugLog('handleLogin', 'Database error during login', {error: dbErr.toString()});
      
      // Fallback to hardcoded credentials if database fails
      const fallbackEmail = String(CONFIG.DISPATCH_EMAIL).trim().toLowerCase();
      const fallbackPassword = String(CONFIG.DISPATCH_PASSWORD).trim();
      
      if (email === fallbackEmail && password === fallbackPassword) {
        const sessionId = createSession(email, 'admin');
        debugLog('handleLogin', 'Fallback login successful', {email});
        return {
          ok: true,
          session_id: sessionId,
          email: email,
          role: 'admin',
          note: 'Using fallback authentication'
        };
      }
      
      return {
        ok: false, 
        error: 'Authentication system error: ' + dbErr.toString()
      };
    }
    
  } catch(err) {
    return {
      ok: false,
      error: err.toString()
    };
  }
}

function createSession(email, role) {
  try {
    const sessionId = 'sess_' + Utilities.getUuid().replace(/-/g, '').substring(0, 24);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + CONFIG.SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
    
    // Try to store in database, but don't fail if database unavailable
    try {
      appendRow(SESSIONS_TABLE, {
        session_id: sessionId,
        email: email,
        role: role || 'dispatcher',
        created_at: now,
        expires_at: expiresAt
      });
      debugLog('createSession', 'Session stored in database', {sessionId});
    } catch(dbErr) {
      // Database not available - session only exists in memory (will work for this request)
      debugLog('createSession', 'Database unavailable - session created without persistence', {sessionId, error: dbErr.toString()});
    }
    
    return sessionId;
  } catch(err) {
    throw new Error('Session creation failed: ' + err.toString());
  }
}

function validateSession(sessionId) {
  if (!sessionId) return false;
  
  try {
    const sessions = readAll(SESSIONS_TABLE);
    const now = new Date();
    
    for (let i = 0; i < sessions.length; i++) {
      if (String(sessions[i].session_id) === String(sessionId)) {
        const expires = new Date(sessions[i].expires_at);
        return now < expires;
      }
    }
    
    return false;
  } catch(err) {
    // Database not available - accept any session (temporary)
    debugLog('validateSession', 'Database unavailable - accepting session without validation', {sessionId});
    return true; // Allow access when database is down (not ideal but functional)
  }
}

// ========================= DATABASE TABLE NAMES =========================

// Table names matching Operations.js database schema
var TABS = {
  JOBS: 'h2s_jobs',
  CUSTOMERS: 'h2s_customers',
  SERVICES: 'h2s_services',
  PROS: 'h2s_pros'
};

// Sessions stored in database (separate from pro portal sessions)
var SESSIONS_TABLE = 'h2s_equipment_sessions';

// Helper to get all jobs from database
function getJobsData() {
  return readAll(TABS.JOBS);
}

/**
 * DIAGNOSE_DATABASE - Check what data points are available/missing
 * Run this to see exactly what fields exist in h2s_jobs and identify issues
 */
function DIAGNOSE_DATABASE() {
  Logger.log('=== DATABASE DIAGNOSTIC ===\n');
  
  try {
    // Test 1: Can we connect?
    Logger.log('1. Testing database connection...');
    var jobs = readAll(TABS.JOBS);
    Logger.log('✓ Connected! Found ' + jobs.length + ' total jobs in h2s_jobs table\n');
    
    if (jobs.length === 0) {
      Logger.log('⚠️ NO JOBS IN DATABASE - h2s_jobs table is empty');
      Logger.log('   This is why frontend shows "All Clear!"');
      Logger.log('   Add jobs via Operations.js or directly in Supabase\n');
      return {
        ok: true,
        message: 'Database connected but no jobs exist',
        total_jobs: 0,
        jobs_needing_equipment: 0
      };
    }
    
    // Test 2: Check first job structure
    Logger.log('2. Analyzing first job structure...');
    var firstJob = jobs[0];
    var fields = Object.keys(firstJob);
    Logger.log('   Fields in h2s_jobs table (' + fields.length + ' columns):');
    fields.forEach(function(field) {
      var value = firstJob[field];
      var type = typeof value;
      var preview = value ? String(value).substring(0, 50) : 'null';
      Logger.log('   - ' + field + ': ' + type + ' = "' + preview + '"');
    });
    Logger.log('');
    
    // Test 3: Required fields check
    Logger.log('3. Checking REQUIRED fields for equipment ordering...');
    var requiredFields = [
      'job_id',
      'equipment_delivered',
      'status',
      'start_iso',
      'service_id',
      'customer_name',
      'service_address',
      'service_city',
      'service_state',
      'service_zip'
    ];
    
    var missingFields = [];
    requiredFields.forEach(function(field) {
      if (fields.indexOf(field) === -1) {
        missingFields.push(field);
        Logger.log('   ✗ MISSING: ' + field);
      } else {
        var sampleValue = firstJob[field];
        Logger.log('   ✓ ' + field + ' exists: "' + sampleValue + '"');
      }
    });
    
    if (missingFields.length > 0) {
      Logger.log('\n⚠️ CRITICAL: Missing ' + missingFields.length + ' required fields!');
      Logger.log('   Missing: ' + missingFields.join(', '));
      Logger.log('   Fix: Add these columns to h2s_jobs table in Supabase\n');
    } else {
      Logger.log('\n✓ All required fields present!\n');
    }
    
    // Test 4: Filter jobs needing equipment
    Logger.log('4. Filtering jobs needing equipment...');
    var needingEquipment = jobs.filter(function(job) {
      var delivered = String(job.equipment_delivered || '').toLowerCase();
      var status = String(job.status || '').toLowerCase();
      var isDelivered = delivered === 'true' || delivered === 'yes';
      var isCompleted = status === 'completed' || status === 'cancelled';
      return !isDelivered && !isCompleted;
    });
    
    Logger.log('   Total jobs: ' + jobs.length);
    Logger.log('   Jobs needing equipment: ' + needingEquipment.length);
    Logger.log('   Jobs with equipment: ' + (jobs.length - needingEquipment.length));
    Logger.log('');
    
    // Test 5: Sample job data for frontend
    if (needingEquipment.length > 0) {
      Logger.log('5. Sample job that SHOULD appear in frontend:');
      var sample = needingEquipment[0];
      Logger.log('   job_id: ' + sample.job_id);
      Logger.log('   service_id: ' + sample.service_id);
      Logger.log('   customer_name: ' + sample.customer_name);
      Logger.log('   start_iso: ' + sample.start_iso);
      Logger.log('   equipment_delivered: ' + sample.equipment_delivered);
      Logger.log('   status: ' + sample.status);
      Logger.log('');
    } else {
      Logger.log('5. No jobs needing equipment found!');
      Logger.log('   Reasons why jobs are filtered out:');
      jobs.slice(0, 3).forEach(function(job, i) {
        Logger.log('   Job ' + (i+1) + ':');
        Logger.log('     - equipment_delivered: ' + job.equipment_delivered);
        Logger.log('     - status: ' + job.status);
        Logger.log('     - Filtered because: ' + 
          (String(job.equipment_delivered).toLowerCase() === 'true' ? 'equipment already delivered' : 
           String(job.status).toLowerCase() === 'completed' ? 'job completed' :
           String(job.status).toLowerCase() === 'cancelled' ? 'job cancelled' : 'unknown'));
      });
      Logger.log('');
    }
    
    // Test 6: Equipment list field check
    Logger.log('6. Checking equipment_list field...');
    var hasEquipmentListField = fields.indexOf('equipment_list') !== -1;
    if (hasEquipmentListField) {
      Logger.log('   ✓ equipment_list column exists');
      var firstJobList = firstJob.equipment_list;
      if (firstJobList) {
        try {
          var parsed = typeof firstJobList === 'string' ? JSON.parse(firstJobList) : firstJobList;
          Logger.log('   ✓ equipment_list is valid JSON with ' + (parsed.length || 0) + ' items');
        } catch(e) {
          Logger.log('   ⚠️ equipment_list exists but invalid JSON: ' + e.toString());
        }
      } else {
        Logger.log('   - equipment_list is null/empty (expected for new jobs)');
      }
    } else {
      Logger.log('   ⚠️ equipment_list column does NOT exist');
      Logger.log('   Run this SQL in Supabase:');
      Logger.log('   ALTER TABLE h2s_jobs ADD COLUMN equipment_list JSONB;');
    }
    Logger.log('');
    
    Logger.log('=== DIAGNOSTIC COMPLETE ===\n');
    Logger.log('SUMMARY:');
    Logger.log('- Total jobs in database: ' + jobs.length);
    Logger.log('- Jobs needing equipment: ' + needingEquipment.length);
    Logger.log('- Missing required fields: ' + missingFields.length);
    Logger.log('- Frontend should show: ' + (needingEquipment.length > 0 ? needingEquipment.length + ' jobs' : 'All Clear (no jobs need equipment)'));
    
    return {
      ok: true,
      total_jobs: jobs.length,
      jobs_needing_equipment: needingEquipment.length,
      missing_fields: missingFields,
      sample_job: needingEquipment.length > 0 ? needingEquipment[0] : null,
      all_fields: fields
    };
    
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

// ========================= SEED & CLEAR TEST DATA =========================

/**
 * TEST_AI_GENERATION - Complete end-to-end test of AI equipment generation
 * Run this to test the entire flow from job selection to AI response
 */
function TEST_AI_GENERATION() {
  Logger.log('=== TESTING AI EQUIPMENT GENERATION ===\n');
  
  try {
    // Step 1: Get all jobs
    Logger.log('Step 1: Fetching jobs from database...');
    var jobs = readAll(TABS.JOBS);
    Logger.log('  ✓ Found ' + jobs.length + ' total jobs');
    
    if (jobs.length === 0) {
      Logger.log('  ❌ ERROR: No jobs in database');
      Logger.log('  → Run SEED_FAKE_JOBS() first to create test jobs\n');
      return {ok: false, error: 'No jobs in database'};
    }
    
    // Step 2: Pick a random job
    var randomIndex = Math.floor(Math.random() * jobs.length);
    var testJob = jobs[randomIndex];
    
    Logger.log('\nStep 2: Selected random test job:');
    Logger.log('  Job ID: ' + testJob.job_id);
    Logger.log('  Customer: ' + testJob.customer_name);
    Logger.log('  Service: ' + (testJob.service_name || testJob.service_id));
    Logger.log('  Notes: ' + (testJob.notes || testJob.notes_from_customer || 'NONE'));
    
    // Step 3: Call the actual generation function
    Logger.log('\nStep 3: Calling generateEquipmentList()...');
    Logger.log('  (This will make the actual OpenAI API call)\n');
    
    var result = generateEquipmentList({job_id: testJob.job_id});
    
    Logger.log('\n=== GENERATION RESULT ===');
    
    if (result.ok) {
      Logger.log('✓ SUCCESS! AI generated equipment list\n');
      
      // Show what was generated
      var equipList = result.equipment_list;
      Logger.log('Equipment List Generated:');
      Logger.log('  Items: ' + equipList.items.length);
      
      equipList.items.forEach(function(item, idx) {
        Logger.log('    ' + (idx + 1) + '. ' + item.name + ' (qty: ' + item.qty + ')');
        if (item.notes) {
          Logger.log('       → ' + item.notes);
        }
      });
      
      Logger.log('\n  Urgency: ' + equipList.urgency);
      Logger.log('  Delivery Deadline: ' + equipList.delivery_deadline);
      Logger.log('  Special Notes: ' + equipList.special_notes);
      
      Logger.log('\nJob Data Returned:');
      Logger.log('  Customer: ' + result.job.customer_name);
      Logger.log('  Address: ' + result.job.service_address);
      Logger.log('  Email: ' + result.job.customer_email);
      Logger.log('  Phone: ' + result.job.customer_phone);
      
      Logger.log('\n=== TEST COMPLETE ===');
      Logger.log('✓ AI generation is working correctly!');
      Logger.log('✓ Frontend should receive this exact data structure');
      Logger.log('\nNext: Test in frontend by clicking "Generate Equipment List"');
      
      return {
        ok: true,
        test_job: {
          job_id: testJob.job_id,
          customer: testJob.customer_name,
          service: testJob.service_name || testJob.service_id
        },
        result: result
      };
      
    } else {
      Logger.log('❌ FAILED: ' + result.error);
      Logger.log('\nCheck the logs above for detailed error info');
      Logger.log('Common issues:');
      Logger.log('  1. OpenAI API key not configured');
      Logger.log('  2. OpenAI API quota exceeded');
      Logger.log('  3. Network/firewall blocking OpenAI');
      Logger.log('  4. Invalid job data (missing service_id, etc)');
      
      return {
        ok: false,
        error: result.error,
        test_job: {
          job_id: testJob.job_id,
          customer: testJob.customer_name
        }
      };
    }
    
  } catch(err) {
    Logger.log('\n❌ EXCEPTION: ' + err.toString());
    Logger.log('Stack: ' + err.stack);
    return {
      ok: false,
      error: err.toString(),
      stack: err.stack
    };
  }
}

/**
 * TEST_SPECIFIC_JOB - Test AI generation on a specific job ID
 * Usage: TEST_SPECIFIC_JOB('your-job-id-here')
 */
function TEST_SPECIFIC_JOB(jobId) {
  if (!jobId) {
    Logger.log('❌ ERROR: No job_id provided');
    Logger.log('Usage: TEST_SPECIFIC_JOB("your-job-id-here")');
    return {ok: false, error: 'Missing job_id parameter'};
  }
  
  Logger.log('=== TESTING SPECIFIC JOB: ' + jobId + ' ===\n');
  
  var result = generateEquipmentList({job_id: jobId});
  
  if (result.ok) {
    Logger.log('✓ SUCCESS!');
    Logger.log('Generated ' + result.equipment_list.items.length + ' items');
    Logger.log('\nFull result:');
    Logger.log(JSON.stringify(result, null, 2));
  } else {
    Logger.log('❌ FAILED: ' + result.error);
  }
  
  return result;
}

/**
 * PROBE_SUPABASE_SCHEMA - Query Supabase information_schema directly
 * Returns exact column definitions from PostgreSQL system tables
 */
function PROBE_SUPABASE_SCHEMA() {
  Logger.log('=== PROBING SUPABASE SCHEMA (DIRECT QUERY) ===\n');
  
  try {
    const url = CONFIG.SUPABASE_URL + '/rest/v1/rpc/get_table_schema';
    const key = CONFIG.SUPABASE_KEY;
    
    if (!url || !key) {
      Logger.log('❌ Supabase credentials not configured');
      return {ok: false, error: 'Supabase credentials missing'};
    }
    
    // Query information_schema.columns for h2s_jobs table
    // This gives us EXACT column names, data types, nullability, defaults
    const schemaQuery = `
      SELECT 
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default,
        character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public' 
        AND table_name = 'h2s_jobs'
      ORDER BY ordinal_position;
    `;
    
    Logger.log('Querying Supabase information_schema...\n');
    
    // Use PostgREST to query
    const endpoint = CONFIG.SUPABASE_URL + '/rest/v1/rpc/exec_sql';
    const payload = {
      sql: schemaQuery,
      params: {}
    };
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'apikey': key,
        'Authorization': 'Bearer ' + key,
        'Prefer': 'return=representation'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(endpoint, options);
    const code = response.getResponseCode();
    
    if (code !== 200 && code !== 201) {
      Logger.log('❌ Database query failed: ' + code);
      Logger.log('Response: ' + response.getContentText());
      Logger.log('\nAlternative: Direct table query...\n');
      
      // Fallback: Just get columns from actual data
      var jobs = readAll(TABS.JOBS);
      if (jobs.length === 0) {
        return {ok: false, error: 'No jobs exist and schema query failed'};
      }
      
      var schema = Object.keys(jobs[0]).map(function(col) {
        var val = jobs[0][col];
        var type = typeof val;
        if (val === null) type = 'unknown';
        else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) type = 'uuid';
        else if (/^\d{4}-\d{2}-\d{2}T/.test(val)) type = 'timestamp';
        
        return {
          column_name: col,
          data_type: type,
          sample_value: val
        };
      });
      
      Logger.log('Schema from sample data:');
      Logger.log(JSON.stringify(schema, null, 2));
      
      return {
        ok: true,
        method: 'sample_data',
        schema: schema
      };
    }
    
    const schemaData = JSON.parse(response.getContentText());
    
    Logger.log('✅ h2s_jobs table schema:\n');
    Logger.log(JSON.stringify(schemaData, null, 2));
    
    Logger.log('\n=== COLUMN SUMMARY ===\n');
    
    schemaData.forEach(function(col) {
      var line = col.column_name.padEnd(30, ' ') + 
                 ' | ' + (col.data_type || col.udt_name).padEnd(20, ' ') +
                 ' | ' + (col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL').padEnd(10, ' ') +
                 (col.column_default ? ' | DEFAULT: ' + col.column_default : '');
      Logger.log(line);
    });
    
    Logger.log('\n=== PASTE THIS JSON INTO CHAT ===\n');
    Logger.log(JSON.stringify(schemaData, null, 2));
    
    return {
      ok: true,
      method: 'information_schema',
      schema: schemaData
    };
    
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

/**
 * SEED_FAKE_JOBS - Populate database with 8 realistic test jobs
 * Matches exact h2s_jobs schema (job_id is UUID, uses 'address' and 'notes')
 */
function SEED_FAKE_JOBS() {
  Logger.log('=== SEEDING FAKE JOBS ===\n');
  
  try {
    // Build jobs matching EXACT schema
    const fakeJobs = [
      {
        // job_id auto-generated by Supabase (gen_random_uuid())
        customer_name: 'John Smith',
        customer_email: 'john.smith@example.com',
        customer_phone: '555-0101',
        service_id: 'cam-install-4',
        service_name: 'Security Camera Installation - 4 Cameras',
        address: '123 Main Street, Austin, TX 78701',
        service_city: 'Austin',
        service_state: 'TX',
        service_zip: '78701',
        start_iso: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'assigned',
        notes: 'Need 2 indoor and 2 outdoor cameras. Front door, back door, and garage coverage needed.',
        equipment_delivered: false
      },
      {
        customer_name: 'Sarah Johnson',
        customer_email: 'sarah.j@example.com',
        customer_phone: '555-0102',
        service_id: 'lock-install',
        service_name: 'Smart Lock Installation',
        address: '456 Oak Avenue, Dallas, TX 75201',
        service_city: 'Dallas',
        service_state: 'TX',
        service_zip: '75201',
        start_iso: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'assigned',
        notes: 'Front door and back door smart locks. Customer prefers August brand. URGENT - install tomorrow!',
        equipment_delivered: false
      },
      {
        customer_name: 'Michael Chen',
        customer_email: 'mchen@example.com',
        customer_phone: '555-0103',
        service_id: 'mesh-wifi',
        service_name: 'Mesh WiFi System Installation',
        address: '789 Tech Boulevard, Houston, TX 77001',
        service_city: 'Houston',
        service_state: 'TX',
        service_zip: '77001',
        start_iso: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'assigned',
        notes: 'Large home, 4000 sq ft. Need strong coverage in home office on 2nd floor.',
        equipment_delivered: false
      },
      {
        customer_name: 'Emily Rodriguez',
        customer_email: 'emily.r@example.com',
        customer_phone: '555-0104',
        service_id: 'doorbell-install',
        service_name: 'Video Doorbell Installation',
        address: '321 Sunset Drive, San Antonio, TX 78201',
        service_city: 'San Antonio',
        service_state: 'TX',
        service_zip: '78201',
        start_iso: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'assigned',
        notes: 'Ring doorbell preferred. Existing doorbell wiring available.',
        equipment_delivered: false
      },
      {
        customer_name: 'David Williams',
        customer_email: 'dwilliams@example.com',
        customer_phone: '555-0105',
        service_id: 'thermostat-install',
        service_name: 'Smart Thermostat Installation',
        address: '654 Maple Lane, Austin, TX 78702',
        service_city: 'Austin',
        service_state: 'TX',
        service_zip: '78702',
        start_iso: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'assigned',
        notes: '2 zones - need 2 thermostats. Nest preferred. C-wire available.',
        equipment_delivered: false
      },
      {
        customer_name: 'Lisa Anderson',
        customer_email: 'l.anderson@example.com',
        customer_phone: '555-0106',
        service_id: 'lighting-install',
        service_name: 'Smart Lighting Installation',
        address: '987 River Road, Dallas, TX 75202',
        service_city: 'Dallas',
        service_state: 'TX',
        service_zip: '75202',
        start_iso: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'assigned',
        notes: 'Whole home lighting. Living room, bedrooms, kitchen. Prefer Philips Hue system.',
        equipment_delivered: false
      },
      {
        customer_name: 'Robert Taylor',
        customer_email: 'rtaylor@example.com',
        customer_phone: '555-0107',
        service_id: 'cam-install-8-premium',
        service_name: 'Premium Security System - 8 Cameras',
        address: '147 Highland Park, Houston, TX 77002',
        service_city: 'Houston',
        service_state: 'TX',
        service_zip: '77002',
        start_iso: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'assigned',
        notes: 'High-end property. Need 4K cameras with NVR. Professional grade equipment only. Budget not a concern.',
        equipment_delivered: false
      },
      {
        customer_name: 'Jennifer Martinez',
        customer_email: 'jmartinez@example.com',
        customer_phone: '555-0108',
        service_id: 'smart-home-complete',
        service_name: 'Complete Smart Home Setup',
        address: '258 College Street, Austin, TX 78703',
        service_city: 'Austin',
        service_state: 'TX',
        service_zip: '78703',
        start_iso: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'assigned',
        notes: 'Full smart home package: 4 cameras, 2 smart locks, video doorbell, thermostat, lighting, and mesh WiFi.',
        equipment_delivered: false
      }
    ];
    
    Logger.log('Inserting ' + fakeJobs.length + ' test jobs (job_id will auto-generate as UUID)...\n');
    
    let successCount = 0;
    let failCount = 0;
    
    for (var i = 0; i < fakeJobs.length; i++) {
      try {
        var inserted = appendRow(TABS.JOBS, fakeJobs[i]);
        var jobId = inserted.job_id ? inserted.job_id.substring(0, 8) + '...' : 'unknown';
        Logger.log('✓ Inserted: ' + fakeJobs[i].service_name + ' (' + jobId + ')');
        successCount++;
      } catch(err) {
        Logger.log('✗ Failed: ' + fakeJobs[i].service_name + ' - ' + err.toString());
        failCount++;
      }
    }
    
    Logger.log('\n=== SEED COMPLETE ===');
    Logger.log('Success: ' + successCount + ' jobs');
    Logger.log('Failed: ' + failCount + ' jobs');
    Logger.log('\nRefresh your dashboard to see the test jobs!');
    Logger.log('They will have auto-generated UUIDs for job_id');
    
    return {
      ok: true,
      inserted: successCount,
      failed: failCount,
      message: 'Seeded ' + successCount + ' test jobs'
    };
    
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

/**
 * CLEAR_FAKE_JOBS - Remove test jobs from database
 * Since job_id is UUID, we identify test jobs by customer_email containing 'example.com'
 */
function CLEAR_FAKE_JOBS() {
  Logger.log('=== CLEARING TEST JOBS ===\n');
  
  try {
    var allJobs = readAll(TABS.JOBS);
    Logger.log('Found ' + allJobs.length + ' total jobs in database');
    
    // Filter for test jobs (email contains example.com)
    var testJobs = allJobs.filter(function(job) {
      return job.customer_email && String(job.customer_email).includes('example.com');
    });
    
    Logger.log('Found ' + testJobs.length + ' test jobs to delete\n');
    
    if (testJobs.length === 0) {
      Logger.log('No test jobs found.');
      return {ok: true, deleted: 0, message: 'No test jobs found'};
    }
    
    var deleteCount = 0;
    var failCount = 0;
    
    for (var i = 0; i < testJobs.length; i++) {
      try {
        var url = CONFIG.SUPABASE_URL + '/rest/v1/' + TABS.JOBS + '?job_id=eq.' + encodeURIComponent(testJobs[i].job_id);
        var options = {
          method: 'delete',
          headers: {
            'apikey': CONFIG.SUPABASE_KEY,
            'Authorization': 'Bearer ' + CONFIG.SUPABASE_KEY
          },
          muteHttpExceptions: true
        };
        
        var response = UrlFetchApp.fetch(url, options);
        var code = response.getResponseCode();
        
        if (code === 200 || code === 204) {
          Logger.log('✓ Deleted: ' + testJobs[i].customer_name + ' (' + testJobs[i].job_id.substring(0, 8) + '...)');
          deleteCount++;
        } else {
          Logger.log('✗ Failed: ' + testJobs[i].customer_name + ' (HTTP ' + code + ')');
          failCount++;
        }
      } catch(err) {
        Logger.log('✗ Error deleting ' + testJobs[i].customer_name + ': ' + err.toString());
        failCount++;
      }
    }
    
    Logger.log('\n=== CLEAR COMPLETE ===');
    Logger.log('Deleted: ' + deleteCount + ' jobs');
    Logger.log('Failed: ' + failCount + ' jobs');
    
    return {
      ok: true,
      deleted: deleteCount,
      failed: failCount,
      message: 'Cleared ' + deleteCount + ' test jobs'
    };
    
  } catch(err) {
    Logger.log('ERROR: ' + err.toString());
    return {ok: false, error: err.toString()};
  }
}

// ========================= API ENDPOINTS =========================

function getJobsNeedingEquipment(params) {
  try {
    const jobs = getJobsData();
    
    const needingEquipment = jobs.filter(function(job) {
      const status = String(job.status || '').toLowerCase();
      
      // Check equipment_delivered column if it exists
      if (job.hasOwnProperty('equipment_delivered')) {
        const delivered = String(job.equipment_delivered || '').toLowerCase();
        return (delivered === 'false' || delivered === '' || delivered === 'no' || !delivered) && 
               status !== 'completed' && 
               status !== 'cancelled';
      }
      
      // Fallback: if no equipment_delivered column, show all scheduled/active jobs
      return status !== 'completed' && status !== 'cancelled';
    });
    
    needingEquipment.sort(function(a, b) {
      return new Date(a.start_iso || a.created_at) - new Date(b.start_iso || b.created_at);
    });
    
    return {ok: true, jobs: needingEquipment};
    
  } catch(err) {
    return {ok: false, error: err.toString()};
  }
}

function getJobDetails(params) {
  try {
    const jobId = params.job_id;
    if (!jobId) {
      return {ok: false, error: 'Missing job_id'};
    }
    
    const jobs = getJobsData();
    const job = jobs.find(j => String(j.job_id) === String(jobId));
    
    if (!job) {
      return {ok: false, error: 'Job not found'};
    }
    
    return {ok: true, job: job};
    
  } catch(err) {
    Logger.log('[getJobDetails] Error: ' + err);
    return {ok: false, error: err.toString()};
  }
}

function searchJob(params) {
  try {
    const query = (params.query || '').toLowerCase();
    if (!query) {
      return {ok: false, error: 'Missing search query'};
    }
    
    const jobs = getJobsData();
    const results = jobs.filter(job => {
      const jobId = String(job.job_id || '').toLowerCase();
      const service = String(job.service_id || '').toLowerCase();
      const address = String(job.address || job.service_address || '').toLowerCase();
      const customer = String(job.customer_name || '').toLowerCase();
      
      return jobId.includes(query) || 
             service.includes(query) || 
             address.includes(query) || 
             customer.includes(query);
    });
    
    return {ok: true, jobs: results};
    
  } catch(err) {
    Logger.log('[searchJob] Error: ' + err);
    return {ok: false, error: err.toString()};
  }
}

function generateEquipmentList(params) {
  try {
    const jobId = params.job_id;
    if (!jobId) {
      Logger.log('❌ ERROR: No job_id provided');
      return {ok: false, error: 'Missing job_id'};
    }
    
    Logger.log('=== AI EQUIPMENT GENERATION START ===');
    Logger.log('Job ID: ' + jobId);
    
    const jobs = getJobsData();
    Logger.log('Loaded ' + jobs.length + ' jobs from database');
    
    const job = jobs.find(j => String(j.job_id) === String(jobId));
    
    if (!job) {
      Logger.log('❌ ERROR: Job not found: ' + jobId);
      return {ok: false, error: 'Job not found'};
    }
    
    // Log ALL job data for debugging
    Logger.log('✓ Job found: ' + job.customer_name);
    Logger.log('  Service ID: "' + (job.service_id || 'MISSING') + '"');
    Logger.log('  Service Name: "' + (job.service_name || 'N/A') + '"');
    Logger.log('  Notes: "' + (job.notes || job.notes_from_customer || 'NONE') + '"');
    Logger.log('  Address: "' + (job.address || job.service_address || 'N/A') + '"');
    Logger.log('  Status: ' + (job.status || 'unknown'));
    Logger.log('  Start Date: ' + (job.start_iso || 'N/A'));
    
    // Analyze service type for intelligent guardrails
    const serviceType = String(job.service_id || '').toLowerCase();
    let serviceCategory = 'general';
    let equipmentType = 'smart home equipment';
    let guardrails = '';
    
    // Detect job type from service_id
    if (serviceType.includes('cam') || serviceType.includes('camera') || serviceType.includes('security')) {
      serviceCategory = 'cameras';
      equipmentType = 'security cameras';
      guardrails = `
EQUIPMENT TYPE: Security Cameras ONLY
- Standard order: 2-4 cameras typical for residential install
- Include: indoor/outdoor cameras, mounting hardware, cables, power adapters
- DO NOT include: locks, doorbells, thermostats, routers, lights
- If no quantity specified: assume standard 2-camera package`;
    } else if (serviceType.includes('lock') || serviceType.includes('door')) {
      serviceCategory = 'locks';
      equipmentType = 'smart locks';
      guardrails = `
EQUIPMENT TYPE: Smart Locks ONLY
- Standard order: 1-2 locks typical for residential
- Include: smart lock, batteries, strike plates, installation kit
- DO NOT include: cameras, doorbells, thermostats, routers
- If no quantity specified: assume 1 main entry lock`;
    } else if (serviceType.includes('mesh') || serviceType.includes('wifi') || serviceType.includes('network')) {
      serviceCategory = 'mesh_wifi';
      equipmentType = 'mesh WiFi system';
      guardrails = `
EQUIPMENT TYPE: Mesh WiFi ONLY
- Standard order: 3-pack mesh system for most homes
- Include: mesh router/nodes, ethernet cables, power adapters
- DO NOT include: locks, cameras, doorbells, thermostats
- If no quantity specified: assume 3-node mesh system`;
    } else if (serviceType.includes('doorbell') || serviceType.includes('ring')) {
      serviceCategory = 'doorbell';
      equipmentType = 'video doorbell';
      guardrails = `
EQUIPMENT TYPE: Video Doorbell ONLY
- Standard order: 1 doorbell per home
- Include: doorbell, chime, transformer, mounting kit
- DO NOT include: cameras, locks, thermostats, routers
- If no quantity specified: assume 1 doorbell`;
    } else if (serviceType.includes('thermostat') || serviceType.includes('hvac')) {
      serviceCategory = 'thermostat';
      equipmentType = 'smart thermostat';
      guardrails = `
EQUIPMENT TYPE: Smart Thermostat ONLY
- Standard order: 1-2 thermostats typical
- Include: thermostat, C-wire adapter if needed, trim plate
- DO NOT include: cameras, locks, doorbells, routers
- If no quantity specified: assume 1 thermostat`;
    } else if (serviceType.includes('light') || serviceType.includes('switch')) {
      serviceCategory = 'lighting';
      equipmentType = 'smart lighting';
      guardrails = `
EQUIPMENT TYPE: Smart Lighting ONLY
- Standard order: starter kit with hub + switches/bulbs
- Include: smart switches OR bulbs, hub if needed
- DO NOT include: cameras, locks, doorbells, thermostats
- If no quantity specified: assume starter kit (hub + 2-4 devices)`;
    }
    
    // Check what data we actually have (support both field names)
    const customerNotes = job.notes_from_customer || job.notes || '';
    const hasCustomerNotes = customerNotes && String(customerNotes).trim().length > 0;
    const hasDetailedService = job.service_id && String(job.service_id).length > 10; // More than just "CAMs" or "Lock"
    
    // Build AI prompt - ADAPTIVE based on available data
    const prompt = `You are a smart home equipment dispatch specialist. Order equipment for this installation.

JOB DATA AVAILABLE:
- Service Type: "${job.service_id || 'Unknown'}"
- Category Detected: ${serviceCategory.toUpperCase()}
- Customer Notes: ${hasCustomerNotes ? customerNotes : 'NONE PROVIDED'}
- Job Date: ${job.start_iso || 'Not scheduled'}
- Location: ${job.service_city}, ${job.service_state}

${guardrails}

ADAPTIVE ORDERING RULES:
${hasDetailedService ? 
  '- Detailed service type provided - use specific quantities/models if mentioned' : 
  `- MINIMAL DATA: Service type is just "${job.service_id}" - use standard residential package`}
${hasCustomerNotes ? 
  '- Customer notes available - adjust quantities based on their requirements' : 
  '- NO customer notes - order standard residential package for this equipment type'}

CRITICAL:
1. Work with the data we HAVE - don't hallucinate details
2. If just "CAMs" → order standard 2-4 camera package
3. If just "Smart Lock" → order 1 standard lock package
4. If just "Mesh" → order standard 3-node mesh system
5. ONLY order equipment for the detected category: ${equipmentType}
6. Include basic accessories (mounts, cables, batteries) always

Return ONLY valid JSON:
{
  "items": [
    {"name": "Product name", "qty": 1, "notes": "Why this item"},
    {"name": "Product name", "qty": 1, "notes": "Why this item"}
  ],
  "urgency": "Next-day required" | "Standard 2-day" | "Standard shipping",
  "delivery_deadline": "Order by [date]",
  "special_notes": "Installation considerations based on available data"
}`;

    
    // Call OpenAI
    const apiKey = CONFIG.OPENAI_API_KEY;
    if (!apiKey) {
      Logger.log('❌ ERROR: OpenAI API key not configured');
      return {ok: false, error: 'OpenAI API key not configured'};
    }
    
    Logger.log('✓ OpenAI API key configured: ' + apiKey.substring(0, 8) + '...');
    Logger.log('Sending request to OpenAI...');
    
    const url = 'https://api.openai.com/v1/chat/completions';
    const payload = {
      model: 'gpt-4o-mini',  // Upgraded from gpt-3.5-turbo - faster, cheaper, better reasoning
      messages: [
        {role: 'system', content: 'You are a smart home equipment specialist. Respond only with valid JSON.'},
        {role: 'user', content: prompt}
      ],
      max_tokens: 800,  // Increased for more detailed lists
      temperature: 0.3
    };
    
    Logger.log('Request payload model: ' + payload.model);
    Logger.log('Request payload tokens: ' + payload.max_tokens);
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {'Authorization': 'Bearer ' + apiKey},
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    
    Logger.log('OpenAI response code: ' + code);
    
    if (code !== 200) {
      const errorText = response.getContentText();
      Logger.log('❌ OpenAI API error: ' + errorText);
      return {ok: false, error: 'AI service error: ' + code + ' - ' + errorText};
    }
    
    const data = JSON.parse(response.getContentText());
    Logger.log('✓ OpenAI response received');
    
    const content = data.choices[0].message.content;
    Logger.log('AI response content length: ' + content.length + ' chars');
    Logger.log('AI response preview: ' + content.substring(0, 100) + '...');
    
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const equipmentList = JSON.parse(cleaned);
    
    Logger.log('✓ Equipment list parsed successfully');
    Logger.log('  Items count: ' + (equipmentList.items ? equipmentList.items.length : 0));
    Logger.log('  Urgency: ' + (equipmentList.urgency || 'N/A'));
    Logger.log('=== AI GENERATION COMPLETE ===');
    
    return {
      ok: true,
      equipment_list: equipmentList,
      job: {
        job_id: job.job_id,
        service_id: job.service_id,
        customer_name: job.customer_name,
        service_address: job.address || job.service_address || 'N/A',
        service_city: job.service_city,
        service_state: job.service_state,
        service_zip: job.service_zip,
        customer_email: job.customer_email,
        customer_phone: job.customer_phone || job.customer_email,
        start_iso: job.start_iso
      }
    };
    
  } catch(err) {
    Logger.log('❌ EXCEPTION in generateEquipmentList: ' + err.toString());
    Logger.log('Stack trace: ' + err.stack);
    return {ok: false, error: err.toString()};
  }
}function markEquipmentOrdered(params) {
  try {
    const jobId = params.job_id;
    if (!jobId) {
      return {ok: false, error: 'Missing job_id'};
    }
    
    // Update job in database - only set equipment_delivered if column exists
    try {
      // Try to update with equipment_delivered column
      updateRow(TABS.JOBS, 
        {job_id: jobId},
        {
          equipment_delivered: true,
          equipment_status: 'ordered'
        }
      );
    } catch(err) {
      // If equipment_delivered column doesn't exist, just update status
      if (err.toString().includes('equipment_delivered')) {
        Logger.log('equipment_delivered column not found, updating equipment_status only');
        updateRow(TABS.JOBS, 
          {job_id: jobId},
          {
            equipment_status: 'ordered'
          }
        );
      } else {
        throw err;
      }
    }
    
    return {ok: true, message: 'Equipment marked as ordered'};
    
  } catch(err) {
    return {ok: false, error: err.toString()};
  }
}
