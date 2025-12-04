-- CLEAR ALL JOBS AND START FRESH
-- ================================
-- Run this to delete all existing jobs and orders for clean testing

-- 1. Delete all dispatch jobs
DELETE FROM h2s_dispatch_jobs;

-- 2. Delete all job lines (if table exists)
DELETE FROM h2s_dispatch_job_lines WHERE 1=1;

-- 3. Delete all orders
DELETE FROM h2s_orders;

-- 4. Delete all payout ledger entries
DELETE FROM h2s_payouts_ledger WHERE 1=1;

-- 5. Verify everything is cleared
SELECT 
  'h2s_dispatch_jobs' as table_name, 
  COUNT(*) as remaining_rows 
FROM h2s_dispatch_jobs
UNION ALL
SELECT 
  'h2s_orders' as table_name, 
  COUNT(*) as remaining_rows 
FROM h2s_orders
UNION ALL
SELECT 
  'h2s_payouts_ledger' as table_name, 
  COUNT(*) as remaining_rows 
FROM h2s_payouts_ledger;

-- Expected result: All counts should be 0

-- IMPORTANT: After running this, test a fresh checkout to verify:
-- - Address populates correctly
-- - Geocoding works (lat/lng present)
-- - Payout calculated from subtotal
-- - Job appears in portal immediately
