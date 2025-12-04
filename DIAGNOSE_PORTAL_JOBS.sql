-- DIAGNOSE WHY PORTAL JOBS AREN'T SHOWING
-- =========================================
-- Run these queries in order to find the issue

-- 1. Check if ANY orders exist
SELECT 
  'ORDERS CHECK' as test,
  COUNT(*) as total_orders,
  MAX(created_at) as most_recent_order
FROM h2s_orders;

-- 2. Check most recent orders with details
SELECT 
  order_id,
  customer_email,
  customer_name,
  subtotal,
  total,
  created_at,
  -- Handle both JSONB metadata column or text metadata_json
  CASE 
    WHEN pg_typeof(metadata) = 'jsonb'::regtype THEN metadata->>'service_address'
    ELSE NULL
  END as address_from_metadata
FROM h2s_orders
ORDER BY created_at DESC
LIMIT 5;

-- 3. Check if ANY jobs exist
SELECT 
  'JOBS CHECK' as test,
  COUNT(*) as total_jobs,
  MAX(created_at) as most_recent_job
FROM h2s_dispatch_jobs;

-- 4. Check most recent jobs with details
SELECT 
  job_id,
  status,
  service_id,
  service_address,
  service_city,
  service_state,
  geo_lat,
  geo_lng,
  payout_amount,
  metadata->>'order_id' as order_id_from_metadata,
  created_at
FROM h2s_dispatch_jobs
ORDER BY created_at DESC
LIMIT 5;

-- 5. Check for orphaned orders (orders with NO jobs)
SELECT 
  o.order_id,
  o.customer_email,
  o.created_at as order_created,
  CASE 
    WHEN j.job_id IS NULL THEN '❌ NO JOB CREATED'
    ELSE '✅ Job exists: ' || j.job_id
  END as job_status
FROM h2s_orders o
LEFT JOIN h2s_dispatch_jobs j ON j.metadata->>'order_id' = o.order_id
WHERE o.created_at > NOW() - INTERVAL '24 hours'
ORDER BY o.created_at DESC;

-- 6. Check if subtotal column exists (needed for payout calculation)
SELECT 
  column_name, 
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE 
  table_name = 'h2s_orders' 
  AND column_name IN ('subtotal', 'total', 'metadata');

-- 7. Check for webhook execution errors (if any orders were created but no jobs)
SELECT 
  o.order_id,
  o.created_at as order_time,
  o.metadata->>'service_address' as has_address,
  o.subtotal as has_subtotal,
  CASE 
    WHEN o.metadata->>'service_address' IS NULL THEN '⚠️ NO ADDRESS IN METADATA'
    WHEN o.subtotal IS NULL THEN '⚠️ NO SUBTOTAL (run ADD_SUBTOTAL_TO_ORDERS.sql)'
    ELSE '✅ Data looks good'
  END as diagnosis
FROM h2s_orders o
WHERE o.created_at > NOW() - INTERVAL '1 hour'
ORDER BY o.created_at DESC;

-- 8. SOLUTION GUIDE
-- Run this to see what to do next:
DO $$
DECLARE
  order_count INT;
  job_count INT;
  recent_orders INT;
  recent_jobs INT;
  has_subtotal BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO order_count FROM h2s_orders;
  SELECT COUNT(*) INTO job_count FROM h2s_dispatch_jobs;
  SELECT COUNT(*) INTO recent_orders FROM h2s_orders WHERE created_at > NOW() - INTERVAL '1 hour';
  SELECT COUNT(*) INTO recent_jobs FROM h2s_dispatch_jobs WHERE created_at > NOW() - INTERVAL '1 hour';
  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'h2s_orders' AND column_name = 'subtotal') INTO has_subtotal;
  
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════';
  RAISE NOTICE 'DIAGNOSTIC RESULTS';
  RAISE NOTICE '═══════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Total Orders: %', order_count;
  RAISE NOTICE 'Total Jobs: %', job_count;
  RAISE NOTICE 'Orders (last hour): %', recent_orders;
  RAISE NOTICE 'Jobs (last hour): %', recent_jobs;
  RAISE NOTICE 'Subtotal column exists: %', has_subtotal;
  RAISE NOTICE '';
  
  IF order_count = 0 THEN
    RAISE NOTICE '❌ NO ORDERS - Need to test checkout first';
  ELSIF job_count = 0 THEN
    RAISE NOTICE '❌ NO JOBS - Webhook not triggering job creation';
    RAISE NOTICE '   Solutions:';
    RAISE NOTICE '   1. Wait 2 min for Vercel deployment (commit a859ebe)';
    RAISE NOTICE '   2. Or manually trigger: POST /api/create_jobs_from_orders';
  ELSIF recent_orders > recent_jobs THEN
    RAISE NOTICE '⚠️ RECENT ORDERS BUT NO JOBS';
    RAISE NOTICE '   Problem: Webhook deployed but not firing';
    IF NOT has_subtotal THEN
      RAISE NOTICE '   ⚠️ Run ADD_SUBTOTAL_TO_ORDERS.sql first!';
    END IF;
  ELSE
    RAISE NOTICE '✅ Orders and Jobs exist - Portal issue';
    RAISE NOTICE '   Check: Portal authentication or query filters';
  END IF;
END $$;
