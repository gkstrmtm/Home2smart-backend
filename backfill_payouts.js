/**
 * BACKFILL PAYOUTS - Create missing payout ledger entries for completed jobs
 * 
 * This script finds all completed jobs that don't have corresponding payout entries
 * and creates them with proper calculations based on job lines and variant pricing.
 * 
 * Run this in Google Apps Script to backfill the Payouts_Ledger table.
 */

function backfillMissingPayouts() {
  Logger.log('\n========================================');
  Logger.log('💰 BACKFILL MISSING PAYOUTS');
  Logger.log('========================================\n');
  
  // Read all completed assignments
  var assignments = readAll(TABS.ASSIGN).filter(function(a) {
    return String(a.state).toLowerCase() === 'completed';
  });
  
  Logger.log('Found %s completed assignments', assignments.length);
  
  // Read existing payouts to avoid duplicates
  var existingPayouts = readAll(TABS.LEDGER).filter(function(p) {
    return String(p.type) === 'job_payout';
  });
  
  var payoutsByJobPro = {};
  existingPayouts.forEach(function(p) {
    var key = String(p.job_id) + '|' + String(p.pro_id);
    payoutsByJobPro[key] = true;
  });
  
  Logger.log('Found %s existing payout entries', existingPayouts.length);
  
  // Index jobs and job lines
  var jobs = indexBy(readAll(TABS.JOBS), 'job_id');
  var allLines = readAll(TABS.JOB_LINES);
  var linesByJob = {};
  allLines.forEach(function(L) {
    var jid = String(L.job_id);
    if (!linesByJob[jid]) linesByJob[jid] = [];
    linesByJob[jid].push(L);
  });
  
  // Index team splits
  var allTeammates = readAll(TABS.JOB_TEAMMATES);
  var teammatesByJob = {};
  allTeammates.forEach(function(t) {
    teammatesByJob[String(t.job_id)] = t;
  });
  
  var created = 0;
  var skipped = 0;
  var errors = 0;
  
  assignments.forEach(function(assignment) {
    var jobId = String(assignment.job_id || '');
    var proId = String(assignment.pro_id || '');
    
    if (!jobId || !proId) {
      Logger.log('⚠️ Invalid assignment - missing job_id or pro_id');
      errors++;
      return;
    }
    
    var key = jobId + '|' + proId;
    
    // Skip if payout already exists
    if (payoutsByJobPro[key]) {
      skipped++;
      return;
    }
    
    var job = jobs[jobId];
    if (!job) {
      Logger.log('⚠️ Job not found: %s', jobId);
      errors++;
      return;
    }
    
    var lines = linesByJob[jobId] || [];
    
    if (lines.length === 0) {
      Logger.log('⚠️ No line items for job %s - skipping', jobId);
      errors++;
      return;
    }
    
    // Calculate total payout from line items
    var totalJobPayout = 0;
    lines.forEach(function(L) {
      var linePayout = Number(L.calc_pro_payout_total || 0) || 0;
      totalJobPayout += linePayout;
    });
    
    if (totalJobPayout === 0) {
      Logger.log('⚠️ Zero payout calculated for job %s - skipping', jobId);
      errors++;
      return;
    }
    
    Logger.log('Job %s: Total payout = $%s', jobId.substring(0, 8), totalJobPayout.toFixed(2));
    
    // Check for team split
    var teamSplit = teammatesByJob[jobId];
    
    if (teamSplit && String(teamSplit.secondary_pro_id || '').trim()) {
      // TEAM JOB - Create payouts for both pros
      var primaryProId = String(teamSplit.primary_pro_id || '');
      var secondaryProId = String(teamSplit.secondary_pro_id || '');
      var splitMode = String(teamSplit.split_mode || 'percent').toLowerCase();
      
      var primaryAmount = 0, secondaryAmount = 0;
      
      if (splitMode === 'percent') {
        var primaryPercent = Number(teamSplit.primary_percent || 50) || 50;
        var secondaryPercent = 100 - primaryPercent;
        primaryAmount = round2(totalJobPayout * primaryPercent / 100);
        secondaryAmount = round2(totalJobPayout * secondaryPercent / 100);
      } else {
        primaryAmount = Number(teamSplit.primary_flat || 0) || 0;
        secondaryAmount = Number(teamSplit.secondary_flat || 0) || 0;
      }
      
      // Create primary payout if this is the primary pro
      if (String(proId) === String(primaryProId) && primaryAmount > 0) {
        try {
          createLedgerPayoutEntry({
            entry_id: id('pay'),
            pro_id: primaryProId,
            job_id: jobId,
            service_id: job.service_id || '',
            service_name: job.service_name || '',
            amount: primaryAmount,
            type: 'job_payout',
            note: 'Team job - Primary tech (backfilled)',
            period_key: computePeriodKey(assignment.completed_at ? new Date(assignment.completed_at) : new Date()),
            created_at: assignment.completed_at || new Date(),
            paid_at: null,
            paid_txn_id: null
          });
          Logger.log('  ✅ Created primary payout: $%s for %s', primaryAmount.toFixed(2), primaryProId.substring(0, 8));
          created++;
        } catch (e) {
          Logger.log('  ❌ Error creating primary payout: %s', e);
          errors++;
        }
      }
      
      // Create secondary payout if this is the secondary pro
      if (String(proId) === String(secondaryProId) && secondaryAmount > 0) {
        try {
          createLedgerPayoutEntry({
            entry_id: id('pay'),
            pro_id: secondaryProId,
            job_id: jobId,
            service_id: job.service_id || '',
            service_name: job.service_name || '',
            amount: secondaryAmount,
            type: 'job_payout',
            note: 'Team job - Secondary tech (backfilled)',
            period_key: computePeriodKey(assignment.completed_at ? new Date(assignment.completed_at) : new Date()),
            created_at: assignment.completed_at || new Date(),
            paid_at: null,
            paid_txn_id: null
          });
          Logger.log('  ✅ Created secondary payout: $%s for %s', secondaryAmount.toFixed(2), secondaryProId.substring(0, 8));
          created++;
        } catch (e) {
          Logger.log('  ❌ Error creating secondary payout: %s', e);
          errors++;
        }
      }
      
    } else {
      // SOLO JOB - Create single payout
      try {
        createLedgerPayoutEntry({
          entry_id: id('pay'),
          pro_id: proId,
          job_id: jobId,
          service_id: job.service_id || '',
          service_name: job.service_name || '',
          amount: totalJobPayout,
          type: 'job_payout',
          note: 'Solo job completion (backfilled)',
          period_key: computePeriodKey(assignment.completed_at ? new Date(assignment.completed_at) : new Date()),
          created_at: assignment.completed_at || new Date(),
          paid_at: null,
          paid_txn_id: null
        });
        Logger.log('  ✅ Created solo payout: $%s for %s', totalJobPayout.toFixed(2), proId.substring(0, 8));
        created++;
      } catch (e) {
        Logger.log('  ❌ Error creating solo payout: %s', e);
        errors++;
      }
    }
  });
  
  Logger.log('\n========================================');
  Logger.log('BACKFILL SUMMARY:');
  Logger.log('  ✅ Created: %s payouts', created);
  Logger.log('  ⏭️  Skipped: %s (already exist)', skipped);
  Logger.log('  ❌ Errors: %s', errors);
  Logger.log('========================================\n');
  
  return {
    ok: true,
    created: created,
    skipped: skipped,
    errors: errors
  };
}

/**
 * Helper to round to 2 decimal places
 */
function round2(num) {
  return Math.round(num * 100) / 100;
}
