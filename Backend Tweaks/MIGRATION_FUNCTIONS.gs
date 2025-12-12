/**
 * HOME2SMART DISPATCH - DATA MIGRATION FUNCTIONS
 * 
 * Run these functions IN ORDER to migrate Google Sheets data to Supabase
 * 
 * PREREQUISITES:
 * 1. All 30 tables created in Supabase (Dispatch.sql already run)
 * 2. Supabase credentials configured in Script Properties
 * 
 * MIGRATION ORDER:
 * 1. migrateCoreTables() - Pros, Customers, Services (no dependencies)
 * 2. migrateJobsAndRelated() - Jobs, Assignments, Artifacts (depends on Pros, Customers, Services)
 * 3. migrateReviewsAndPayouts() - Reviews, Payouts, etc. (depends on Jobs, Pros)
 * 4. migrateSupportTables() - Settings, Geo Cache, Sessions, etc.
 * 5. verifyMigration() - Check row counts and data integrity
 */

/* ========================= CONFIGURATION ========================= */

var SHEET_ID = '1wkUbBwSM841XOSa-4V3C0vwvv5arJUtnl6XYlTFUNcY';

// Global ID mapping: old Sheet IDs → new database UUIDs
var ID_MAP = {
  pros: {},
  customers: {},
  services: {},
  service_variants: {},
  jobs: {},
  reviews: {}
};

function ss() { 
  return SpreadsheetApp.openById(SHEET_ID); 
}

function sh(name) {
  var s = ss().getSheetByName(name);
  if (!s) throw new Error('Missing sheet: ' + name);
  return s;
}

function getSupabaseConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_ANON_KEY');
  
  if (!url || !key) {
    throw new Error('Supabase credentials not configured. Run setupSupabaseCredentials() first.');
  }
  
  return {
    url: url,
    key: key
  };
}

function supabaseQuery_(sql, params) {
  var config = getSupabaseConfig_();
  var url = config.url + '/rest/v1/rpc/exec_sql';
  
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': config.key,
      'Authorization': 'Bearer ' + config.key,
      'Prefer': 'return=representation'
    },
    payload: JSON.stringify({
      sql: sql,
      params: params || []
    }),
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  
  if (code !== 200 && code !== 201) {
    throw new Error('Query failed: ' + text);
  }
  
  return JSON.parse(text);
}

function setupSupabaseCredentials() {
  var ui = SpreadsheetApp.getUi();
  
  var urlResponse = ui.prompt(
    'Supabase Configuration',
    'Enter your Supabase URL (e.g., https://xxxxx.supabase.co):',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (urlResponse.getSelectedButton() !== ui.Button.OK) {
    ui.alert('Setup cancelled');
    return;
  }
  
  var supabaseUrl = urlResponse.getResponseText().trim();
  
  var keyResponse = ui.prompt(
    'Supabase Configuration',
    'Enter your Supabase Anon Key:',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (keyResponse.getSelectedButton() !== ui.Button.OK) {
    ui.alert('Setup cancelled');
    return;
  }
  
  var supabaseKey = keyResponse.getResponseText().trim();
  
  if (!supabaseUrl || !supabaseUrl.includes('supabase.co')) {
    ui.alert('Error: Invalid Supabase URL');
    return;
  }
  
  if (!supabaseKey || supabaseKey.length < 20) {
    ui.alert('Error: Invalid Supabase Key');
    return;
  }
  
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SUPABASE_URL', supabaseUrl);
  props.setProperty('SUPABASE_ANON_KEY', supabaseKey);
  
  ui.alert('Success!', 'Supabase credentials configured.', ui.ButtonSet.OK);
  Logger.log('✅ Supabase credentials configured');
}

/* ========================= MIGRATION STEP 1: CORE TABLES ========================= */

/**
 * Load existing ID mappings from the database for already-migrated tables
 * This helps map foreign keys when data was migrated in previous runs
 */
function loadExistingIdMappings() {
  Logger.log('📥 Loading existing ID mappings from database...');
  
  try {
    var config = getSupabaseConfig_();
    
    // Load existing Pros mappings (match by email)
    var prosSheet = sh('Pros').getDataRange().getValues();
    var prosHeaders = prosSheet[0];
    var proIdIdx = prosHeaders.indexOf('pro_id');
    var emailIdx = prosHeaders.indexOf('email');
    
    if (proIdIdx > -1 && emailIdx > -1) {
      for (var i = 1; i < prosSheet.length; i++) {
        var oldProId = prosSheet[i][proIdIdx];
        var email = prosSheet[i][emailIdx];
        if (email) {
          // Query database for UUID by email using REST API
          var url = config.url + '/rest/v1/h2s_dispatch_pros?email=eq.' + encodeURIComponent(email) + '&select=pro_id';
          var options = {
            method: 'get',
            headers: {
              'apikey': config.key,
              'Authorization': 'Bearer ' + config.key
            },
            muteHttpExceptions: true
          };
          var response = UrlFetchApp.fetch(url, options);
          if (response.getResponseCode() === 200) {
            var result = JSON.parse(response.getContentText());
            if (result && result.length > 0) {
              ID_MAP.pros[String(oldProId)] = result[0].pro_id;
            }
          }
        }
      }
      Logger.log('  ✓ Loaded ' + Object.keys(ID_MAP.pros).length + ' Pro ID mappings');
    }
    
    // Load existing Customers mappings (match by email)
    var customersSheet = sh('Customers').getDataRange().getValues();
    var customersHeaders = customersSheet[0];
    var customerIdIdx = customersHeaders.indexOf('customer_id');
    var custEmailIdx = customersHeaders.indexOf('email');
    
    if (customerIdIdx > -1 && custEmailIdx > -1) {
      for (var c = 1; c < customersSheet.length; c++) {
        var oldCustomerId = customersSheet[c][customerIdIdx];
        var custEmail = customersSheet[c][custEmailIdx];
        if (custEmail) {
          // Query database for UUID by email using REST API
          var urlCust = config.url + '/rest/v1/h2s_dispatch_customers?email=eq.' + encodeURIComponent(custEmail) + '&select=customer_id';
          var optionsCust = {
            method: 'get',
            headers: {
              'apikey': config.key,
              'Authorization': 'Bearer ' + config.key
            },
            muteHttpExceptions: true
          };
          var responseCust = UrlFetchApp.fetch(urlCust, optionsCust);
          if (responseCust.getResponseCode() === 200) {
            var resultCust = JSON.parse(responseCust.getContentText());
            if (resultCust && resultCust.length > 0) {
              ID_MAP.customers[String(oldCustomerId)] = resultCust[0].customer_id;
            }
          }
        }
      }
      Logger.log('  ✓ Loaded ' + Object.keys(ID_MAP.customers).length + ' Customer ID mappings');
    }
    
    // Load existing Services mappings (match by name)
    var servicesSheet = sh('Services').getDataRange().getValues();
    var servicesHeaders = servicesSheet[0];
    var serviceIdIdx = servicesHeaders.indexOf('service_id');
    var nameIdx = servicesHeaders.indexOf('name');
    
    if (serviceIdIdx > -1 && nameIdx > -1) {
      for (var j = 1; j < servicesSheet.length; j++) {
        var oldServiceId = servicesSheet[j][serviceIdIdx];
        var name = servicesSheet[j][nameIdx];
        if (name) {
          // Query database for UUID by name using REST API
          var urlSvc = config.url + '/rest/v1/h2s_dispatch_services?name=eq.' + encodeURIComponent(name) + '&select=service_id';
          var optionsSvc = {
            method: 'get',
            headers: {
              'apikey': config.key,
              'Authorization': 'Bearer ' + config.key
            },
            muteHttpExceptions: true
          };
          var responseSvc = UrlFetchApp.fetch(urlSvc, optionsSvc);
          if (responseSvc.getResponseCode() === 200) {
            var resultSvc = JSON.parse(responseSvc.getContentText());
            if (resultSvc && resultSvc.length > 0) {
              ID_MAP.services[String(oldServiceId)] = resultSvc[0].service_id;
            }
          }
        }
      }
      Logger.log('  ✓ Loaded ' + Object.keys(ID_MAP.services).length + ' Service ID mappings');
    }
    
  } catch(e) {
    Logger.log('⚠️ Could not load existing mappings: ' + e.toString());
  }
}

function migrateCoreTables() {
  Logger.log('=== MIGRATION STEP 1: Core Tables ===');
  
  // Load existing ID mappings first (for foreign key translation)
  loadExistingIdMappings();
  
  var tables = [
    {sheet: 'Pros', idCol: 'pro_id'},
    {sheet: 'Customers', idCol: 'customer_id'},
    {sheet: 'Services', idCol: 'service_id'},
    {sheet: 'Service_Variants', idCol: 'variant_id'},
    {sheet: 'Pros_Availability', idCol: 'avail_id'}
  ];
  
  var results = {};
  
  tables.forEach(function(table){
    try {
      var count = migrateTable_(table.sheet, table.idCol);
      results[table.sheet] = {success: true, count: count};
      Logger.log('✅ ' + table.sheet + ': ' + count + ' rows migrated');
    } catch(e) {
      results[table.sheet] = {success: false, error: e.toString()};
      Logger.log('❌ ' + table.sheet + ': FAILED - ' + e.toString());
    }
  });
  
  Logger.log('=== Step 1 Complete ===');
  return results;
}

/* ========================= MIGRATION STEP 2: JOBS & RELATED ========================= */

function migrateJobsAndRelated() {
  Logger.log('=== MIGRATION STEP 2: Jobs & Related Tables ===');
  
  // Load existing ID mappings first (for foreign key translation)
  loadExistingIdMappings();
  
  var tables = [
    {sheet: 'Jobs', idCol: 'job_id'},
    {sheet: 'Job_Lines', idCol: 'line_id'},
    {sheet: 'Job_Assignments', idCol: 'assign_id'},
    {sheet: 'Job_Artifacts', idCol: 'artifact_id'},
    {sheet: 'Job_Invites', idCol: 'invite_id'},
    {sheet: 'Job_Reminders', idCol: 'reminder_id'},
    {sheet: 'Job_Teammates', idCol: 'row_id'}
  ];
  
  var results = {};
  
  tables.forEach(function(table){
    try {
      var count = migrateTable_(table.sheet, table.idCol);
      results[table.sheet] = {success: true, count: count};
      Logger.log('✅ ' + table.sheet + ': ' + count + ' rows migrated');
    } catch(e) {
      results[table.sheet] = {success: false, error: e.toString()};
      Logger.log('❌ ' + table.sheet + ': FAILED - ' + e.toString());
    }
  });
  
  Logger.log('=== Step 2 Complete ===');
  return results;
}

/* ========================= MIGRATION STEP 3: REVIEWS & PAYOUTS ========================= */

function migrateReviewsAndPayouts() {
  Logger.log('=== MIGRATION STEP 3: Reviews & Payouts ===');
  
  // Load existing ID mappings first (for foreign key translation)
  loadExistingIdMappings();
  
  var tables = [
    {sheet: 'Reviews', idCol: 'review_id'},
    {sheet: 'Replies', idCol: 'reply_id'},
    {sheet: 'Payouts_Ledger', idCol: 'payout_id'},
    {sheet: 'Payout_Splits', idCol: 'split_id'},
    {sheet: 'Care_Plans_Lookup', idCol: 'id'}
  ];
  
  var results = {};
  
  tables.forEach(function(table){
    try {
      var count = migrateTable_(table.sheet, table.idCol);
      results[table.sheet] = {success: true, count: count};
      Logger.log('✅ ' + table.sheet + ': ' + count + ' rows migrated');
    } catch(e) {
      results[table.sheet] = {success: false, error: e.toString()};
      Logger.log('❌ ' + table.sheet + ': FAILED - ' + e.toString());
    }
  });
  
  Logger.log('=== Step 3 Complete ===');
  return results;
}

/* ========================= MIGRATION STEP 4: SUPPORT TABLES ========================= */

function migrateSupportTables() {
  Logger.log('=== MIGRATION STEP 4: Support Tables ===');
  
  var tables = [
    {sheet: 'Settings', idCol: 'id'},
    {sheet: 'Geo_Cache', idCol: 'id'},
    {sheet: 'Sessions', idCol: 'session_id'},
    {sheet: 'Notifications', idCol: 'notif_id'},
    {sheet: 'Variant_Aliases', idCol: 'alias_id'},
    {sheet: 'Audit_Log', idCol: 'log_id'},
    {sheet: 'Review_Tags', idCol: 'id'},
    {sheet: 'Payouts_Config', idCol: 'id'}
  ];
  
  var results = {};
  
  tables.forEach(function(table){
    try {
      var count = migrateTable_(table.sheet, table.idCol);
      results[table.sheet] = {success: true, count: count};
      Logger.log('✅ ' + table.sheet + ': ' + count + ' rows migrated');
    } catch(e) {
      results[table.sheet] = {success: false, error: e.toString()};
      Logger.log('❌ ' + table.sheet + ': FAILED - ' + e.toString());
    }
  });
  
  Logger.log('=== Step 4 Complete ===');
  return results;
}

/* ========================= CORE MIGRATION HELPER ========================= */

function migrateTable_(sheetName, idColumn) {
  var config = getSupabaseConfig_();
  var tableName = 'h2s_dispatch_' + sheetName.toLowerCase();
  
  // Read all rows from Google Sheets
  var ws = sh(sheetName);
  var lastRow = ws.getLastRow();
  if (lastRow < 2) {
    Logger.log('⚠️ ' + sheetName + ' is empty, skipping');
    return 0;
  }
  
  var data = ws.getDataRange().getValues();
  var headers = data[0].map(String).map(function(h){ return h.trim().toLowerCase(); });
  
  Logger.log('📊 ' + sheetName + ' - Sheet Headers: ' + JSON.stringify(headers));
  Logger.log('📊 ' + sheetName + ' - ID Column to skip: ' + idColumn);
  Logger.log('📊 ' + sheetName + ' - Target table: ' + tableName);
  Logger.log('📊 ' + sheetName + ' - Total rows to process: ' + (data.length - 1));
  
  var migratedCount = 0;
  var errorCount = 0;
  var duplicateCount = 0;
  
  // Determine which table we're migrating for ID mapping
  var mapKey = sheetName.toLowerCase().replace(/_/g, '');
  
  // Process rows ONE AT A TIME to handle inconsistent data
  var totalRows = data.length - 1;
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    var oldId = null; // Store the old Sheet ID for mapping
    
    // Map sheet columns to database columns - include ALL columns EXCEPT primary key IDs
    for (var k = 0; k < headers.length; k++) {
      var header = headers[k];
      if (!header || header === '') continue;
      
      // SKIP primary key ID columns - let database generate UUIDs
      if (idColumn && header === idColumn.toLowerCase()) {
        oldId = row[k]; // Save for mapping
        // Only log first row's ID skip
        if (i === 1) {
          Logger.log('  🔑 Skipping ID column "' + header + '" - letting database generate UUIDs');
        }
        continue; // Don't include in insert
      }
      
      // Handle column name mappings (Sheet → Database)
      // "when" is a PostgreSQL reserved keyword, mapped to "when_ts" in database
      if (header === 'when') {
        header = 'when_ts';
      }
      
      var value = row[k];
      
      // Convert empty strings to null
      if (value === null || value === undefined || value === '') {
        obj[header] = null;
        continue;
      }
      
      // Handle foreign key mappings - convert old IDs to new UUIDs
      if (header === 'job_id' && typeof value === 'string') {
        // Map old job ID to new UUID
        var newJobId = ID_MAP.jobs[value];
        if (newJobId) {
          obj[header] = newJobId;
        } else {
          // Job not found - set to null to avoid FK constraint error
          obj[header] = null;
        }
        continue;
      }
      
      if (header === 'review_id' && typeof value === 'string') {
        // Map old review ID to new UUID
        var newReviewId = ID_MAP.reviews[value];
        if (newReviewId) {
          obj[header] = newReviewId;
        } else {
          // Review not found - set to null to avoid FK constraint error
          obj[header] = null;
        }
        continue;
      }
      
      if (header === 'service_id' && typeof value === 'string') {
        // Map old service code to new UUID
        var newServiceId = ID_MAP.services[value];
        if (newServiceId) {
          obj[header] = newServiceId;
        } else {
          // Service not found - set to null to avoid FK constraint error
          obj[header] = null;
        }
        continue;
      }
      
      if (header === 'customer_id' && typeof value === 'string') {
        // Map old customer ID to new UUID
        var newCustomerId = ID_MAP.customers[value];
        if (newCustomerId) {
          obj[header] = newCustomerId;
        } else {
          // Customer not found - set to null to avoid FK constraint error
          obj[header] = null;
        }
        continue;
      }
      
      if (header === 'pro_id' && typeof value === 'string' && value.indexOf('pro_') === 0) {
        // Map old pro ID to new UUID
        var newProId = ID_MAP.pros[value];
        if (newProId) {
          obj[header] = newProId;
        } else {
          // Pro not found - set to null to avoid FK constraint error
          obj[header] = null;
        }
        continue;
      }
      
      // Handle TIME fields - convert ISO timestamps to HH:MM:SS
      if ((header === 'start_time_local' || header === 'end_time_local') && value instanceof Date) {
        var hours = ('0' + value.getHours()).slice(-2);
        var minutes = ('0' + value.getMinutes()).slice(-2);
        var seconds = ('0' + value.getSeconds()).slice(-2);
        obj[header] = hours + ':' + minutes + ':' + seconds;
        continue;
      }
      
      // Handle numeric fields with text - strip to null if not a valid number
      if ((header === 'pro_payout_percent' || header.includes('payout')) && typeof value === 'string') {
        // Check if it contains non-numeric characters (except decimal point)
        if (value.match(/[^\d.]/)) {
          obj[header] = null; // Set to null if contains text
        } else {
          obj[header] = value;
        }
        continue;
      }
      
      // Handle dates
      if (value instanceof Date) {
        obj[header] = value.toISOString();
      } 
      // Handle ZIP codes - extract 5-digit base zip if it contains hyphen
      else if (header === 'zip' && typeof value === 'string' && value.indexOf('-') > -1) {
        obj[header] = value.split('-')[0]; // "29649-7405" → "29649"
      }
      // Handle numbers that should be text (like variant_code)
      else if (typeof value === 'number' && header.includes('code')) {
        obj[header] = value.toString();
      }
      // Handle booleans
      else if (typeof value === 'boolean') {
        obj[header] = value;
      }
      // Everything else as string
      else {
        obj[header] = String(value);
      }
    }
    
    // Ensure timestamps exist
    if (!obj.created_at) obj.created_at = new Date().toISOString();
    if (!obj.updated_at) obj.updated_at = new Date().toISOString();
    
    // Log first row details for debugging
    if (i === 1) {
      Logger.log('📝 Row 1 - Object keys being sent: ' + JSON.stringify(Object.keys(obj)));
      Logger.log('📝 Row 1 - Sample values: ' + JSON.stringify(obj).substring(0, 300));
    }
    
    // Insert single row and get back the generated UUID
    try {
      var newUuid = insertSingleRowWithReturn_(tableName, obj, idColumn);
      migratedCount++;
      
      // Store ID mapping if we have both old and new IDs
      if (oldId && newUuid && ID_MAP[mapKey]) {
        ID_MAP[mapKey][String(oldId)] = newUuid;
      }
      
      if (migratedCount % 10 === 0) {
        Logger.log('  ✅ Progress: ' + migratedCount + '/' + totalRows + ' rows migrated');
      }
    } catch(e) {
      var errorMsg = e.toString();
      
      // Check if it's a duplicate key error (already migrated)
      if (errorMsg.indexOf('23505') > -1 || errorMsg.indexOf('already exists') > -1) {
        duplicateCount++;
        // Only log duplicate message once
        if (duplicateCount === 1) {
          Logger.log('  ℹ️ Skipping duplicates (data already in database)...');
        }
        continue;
      }
      
      // Log other errors
      errorCount++;
      Logger.log('  ⚠️ Row ' + i + ' FAILED');
      Logger.log('     Old ID: ' + oldId);
      Logger.log('     Error: ' + errorMsg.substring(0, 200));
      
      // Only log full object for first few errors
      if (errorCount <= 2) {
        Logger.log('     Full object: ' + JSON.stringify(obj));
      }
    }
  }
  
  var summary = '✅ ' + sheetName + ': ' + migratedCount + ' new rows migrated';
  if (duplicateCount > 0) summary += ', ' + duplicateCount + ' duplicates skipped';
  if (errorCount > 0) summary += ', ' + errorCount + ' errors';
  Logger.log(summary);
  
  // Log ID mapping count
  if (ID_MAP[mapKey] && Object.keys(ID_MAP[mapKey]).length > 0) {
    Logger.log('   📋 ID Mapping: ' + Object.keys(ID_MAP[mapKey]).length + ' ' + mapKey + ' IDs mapped');
  }
  
  return migratedCount;
}

function insertBatch_(tableName, rows) {
  if (!rows || rows.length === 0) return 0;
  
  var config = getSupabaseConfig_();
  var url = config.url + '/rest/v1/' + tableName;
  
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': config.key,
      'Authorization': 'Bearer ' + config.key,
      'Prefer': 'return=minimal'
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  
  if (code !== 201 && code !== 200) {
    throw new Error('Batch insert failed: ' + response.getContentText());
  }
  
  return rows.length;
}

function insertSingleRow_(tableName, row) {
  if (!row) return 0;
  
  var config = getSupabaseConfig_();
  var url = config.url + '/rest/v1/' + tableName;
  
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': config.key,
      'Authorization': 'Bearer ' + config.key,
      'Prefer': 'return=minimal'
    },
    payload: JSON.stringify(row),
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  
  if (code !== 201 && code !== 200) {
    var errorText = response.getContentText();
    throw new Error(errorText);
  }
  
  return 1;
}

/**
 * Insert a single row and return the generated primary key UUID
 */
function insertSingleRowWithReturn_(tableName, row, idColumn) {
  if (!row) return null;
  
  var config = getSupabaseConfig_();
  var url = config.url + '/rest/v1/' + tableName;
  
  // Only log details on first row or errors (not every duplicate)
  // Logger.log('  🌐 POST to: ' + url);
  // Logger.log('  📦 Payload keys: ' + JSON.stringify(Object.keys(row)));
  
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': config.key,
      'Authorization': 'Bearer ' + config.key,
      'Prefer': 'return=representation'  // Return the inserted row with generated UUID
    },
    payload: JSON.stringify(row),
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var responseText = response.getContentText();
  
  // Logger.log('  📡 Response code: ' + code);
  
  if (code !== 201 && code !== 200) {
    // Logger.log('  ❌ Response body: ' + responseText);
    throw new Error(responseText);
  }
  
  // Logger.log('  ✅ Response: ' + responseText.substring(0, 200));
  
  // Parse response to get the generated UUID
  try {
    var result = JSON.parse(responseText);
    if (result && result.length > 0 && idColumn) {
      var newUuid = result[0][idColumn.toLowerCase()];
      // Logger.log('  🆔 Generated UUID: ' + newUuid);
      return newUuid;
    }
  } catch(e) {
    Logger.log('⚠️ Could not parse UUID from response: ' + e.toString());
  }
  
  return null;
}

/* ========================= VERIFICATION ========================= */

/**
 * DANGER: Clear all data from database tables
 * Use this if you want to start migration from scratch
 */
function clearAllDatabaseTables() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    '⚠️ DANGER: Clear All Database Data',
    'This will DELETE ALL DATA from your Supabase tables.\n\n' +
    'Are you absolutely sure you want to continue?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) {
    Logger.log('Clear operation cancelled');
    return;
  }
  
  Logger.log('=== CLEARING ALL DATABASE TABLES ===');
  
  var tables = [
    'h2s_dispatch_pros',
    'h2s_dispatch_customers', 
    'h2s_dispatch_services',
    'h2s_dispatch_service_variants',
    'h2s_dispatch_pros_availability',
    'h2s_dispatch_jobs',
    'h2s_dispatch_job_lines',
    'h2s_dispatch_job_assignments',
    'h2s_dispatch_job_artifacts',
    'h2s_dispatch_reviews'
  ];
  
  tables.forEach(function(table) {
    try {
      var sql = 'DELETE FROM ' + table;
      supabaseQuery_(sql, []);
      Logger.log('✅ Cleared: ' + table);
    } catch(e) {
      Logger.log('❌ Failed to clear ' + table + ': ' + e.toString());
    }
  });
  
  Logger.log('=== DATABASE CLEARED ===');
  Logger.log('You can now run migration functions to re-import data.');
}

function verifyMigration() {
  Logger.log('=== MIGRATION VERIFICATION ===');
  
  var tables = [
    'Pros', 'Customers', 'Services', 'Service_Variants', 'Pros_Availability',
    'Jobs', 'Job_Lines', 'Job_Assignments', 'Job_Artifacts', 'Job_Invites',
    'Reviews', 'Replies', 'Payouts_Ledger', 'Settings', 'Notifications'
  ];
  
  var report = [];
  
  tables.forEach(function(sheetName){
    try {
      var sheetCount = getSheetRowCount_(sheetName);
      var dbCount = getDatabaseRowCount_(sheetName);
      var match = sheetCount === dbCount;
      
      report.push({
        table: sheetName,
        sheets: sheetCount,
        database: dbCount,
        match: match ? '✅' : '❌',
        diff: dbCount - sheetCount
      });
      
      Logger.log(
        (match ? '✅' : '❌') + ' ' + sheetName + ': ' +
        'Sheets=' + sheetCount + ', DB=' + dbCount +
        (match ? '' : ' (diff: ' + (dbCount - sheetCount) + ')')
      );
    } catch(e) {
      Logger.log('❌ ' + sheetName + ': Error - ' + e.toString());
    }
  });
  
  Logger.log('=== Verification Complete ===');
  return report;
}

function getSheetRowCount_(sheetName) {
  var ws = sh(sheetName);
  return Math.max(0, ws.getLastRow() - 1); // Subtract header row
}

function getDatabaseRowCount_(sheetName) {
  var config = getSupabaseConfig_();
  var tableName = 'h2s_dispatch_' + sheetName.toLowerCase();
  
  // Use REST API - fetch minimal data with count header
  var url = config.url + '/rest/v1/' + tableName + '?select=*&limit=1';
  
  var options = {
    method: 'get',
    headers: {
      'apikey': config.key,
      'Authorization': 'Bearer ' + config.key,
      'Prefer': 'count=exact'
    },
    muteHttpExceptions: true
  };
  
  try {
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200 || response.getResponseCode() === 206) {
      var headers = response.getHeaders();
      var contentRange = headers['Content-Range'] || headers['content-range'];
      if (contentRange) {
        // Content-Range format: "0-9/100" or "*/100"  
        var parts = contentRange.split('/');
        if (parts.length === 2) {
          return parseInt(parts[1]);
        }
      }
    }
  } catch(e) {
    Logger.log('⚠️ Error counting ' + tableName + ': ' + e.toString());
  }
  
  return 0;
}

/* ========================= QUICK MIGRATION (ALL AT ONCE) ========================= */

function migrateAllData() {
  Logger.log('=== FULL MIGRATION START ===');
  Logger.log('This may take several minutes...');
  
  var step1 = migrateCoreTables();
  Utilities.sleep(2000);
  
  var step2 = migrateJobsAndRelated();
  Utilities.sleep(2000);
  
  var step3 = migrateReviewsAndPayouts();
  Utilities.sleep(2000);
  
  var step4 = migrateSupportTables();
  Utilities.sleep(2000);
  
  Logger.log('=== FULL MIGRATION COMPLETE ===');
  Logger.log('Running verification...');
  
  var verification = verifyMigration();
  
  return {
    step1: step1,
    step2: step2,
    step3: step3,
    step4: step4,
    verification: verification
  };
}
