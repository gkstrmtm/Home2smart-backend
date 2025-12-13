/**
 * SEED PAYOUT TEST DATA
 * 
 * POST /api/seed_payout_test_data?token=ADMIN_TOKEN
 * 
 * Creates realistic test data for payout dashboard:
 * - Orders with customer details and service items
 * - Dispatch jobs from those orders
 * - Pro assignments
 * - Job artifacts (photos/signatures)
 * - Payouts in various states
 */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Admin authentication
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  const ADMIN_SECRET = process.env.ADMIN_SIGNIN_SECRET || 'h2s_admin_2024';
  const expectedToken = createHash('sha256').update(ADMIN_SECRET).digest('hex');

  if (!token || token !== expectedToken) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const results = {
      ok: true,
      created: {
        orders: 0,
        jobs: 0,
        pros: 0,
        assignments: 0,
        artifacts: 0,
        payouts: 0
      }
    };

    // 1. Create test pros
    const testPros = [
      { pro_id: 'pro_tabari', name: 'Tabari Roper', email: 'tabariroper14@icloud.com', phone: '555-0101', bio: 'Expert TV installer with 5+ years experience', hourly_rate: 75 },
      { pro_id: 'pro_james', name: 'James Wilson', email: 'james.w@example.com', phone: '555-0102', bio: 'Professional handyman specializing in smart home setups', hourly_rate: 65 },
      { pro_id: 'pro_sarah', name: 'Sarah Martinez', email: 'sarah.m@example.com', phone: '555-0103', bio: 'Licensed electrician and home theater specialist', hourly_rate: 85 }
    ];

    for (const pro of testPros) {
      const { error } = await supabase.from('h2s_pros').upsert(pro, { onConflict: 'pro_id' });
      if (!error) results.created.pros++;
    }

    // 2. Create test orders with realistic services
    const testOrders = [
      {
        order_id: 'ord_test_001',
        customer_name: 'Michael Thompson',
        customer_email: 'michael.t@example.com',
        service_name: '75" TV Mount Installation',
        items: JSON.stringify([
          { service_id: 'tv-mount-75', service_name: '75" TV Mount Installation', qty: 1, unit_price: 299, line_total: 299 }
        ]),
        total: 299,
        subtotal: 299,
        status: 'completed',
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days ago
      },
      {
        order_id: 'ord_test_002',
        customer_name: 'Jennifer Davis',
        customer_email: 'jennifer.d@example.com',
        service_name: 'Soundbar Installation',
        items: JSON.stringify([
          { service_id: 'soundbar-install', service_name: 'Soundbar Installation', qty: 1, unit_price: 149, line_total: 149 }
        ]),
        total: 149,
        subtotal: 149,
        status: 'completed',
        created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
      },
      {
        order_id: 'ord_test_003',
        customer_name: 'Robert Chen',
        customer_email: 'robert.c@example.com',
        service_name: 'Home Theater Setup (3 items)',
        items: JSON.stringify([
          { service_id: 'tv-mount-65', service_name: '65" TV Mount Installation', qty: 1, unit_price: 249, line_total: 249 },
          { service_id: 'soundbar-install', service_name: 'Soundbar Installation', qty: 1, unit_price: 149, line_total: 149 },
          { service_id: 'cable-management', service_name: 'Cable Management', qty: 1, unit_price: 99, line_total: 99 }
        ]),
        total: 497,
        subtotal: 497,
        status: 'completed',
        created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago
      },
      {
        order_id: 'ord_test_004',
        customer_name: 'Amanda White',
        customer_email: 'amanda.w@example.com',
        service_name: '85" TV Mount Installation',
        items: JSON.stringify([
          { service_id: 'tv-mount-85', service_name: '85" TV Mount Installation', qty: 1, unit_price: 349, line_total: 349 }
        ]),
        total: 349,
        subtotal: 349,
        status: 'completed',
        created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() // 5 hours ago
      }
    ];

    for (const order of testOrders) {
      const { error } = await supabase.from('h2s_orders').upsert(order, { onConflict: 'order_id' });
      if (!error) results.created.orders++;
    }

    // 3. Create dispatch jobs from orders
    const testJobs = [
      {
        job_id: 'job_test_001',
        status: 'completed',
        customer_name: 'Michael Thompson',
        customer_email: 'michael.t@example.com',
        service_name: '75" TV Mount Installation',
        service_address: '123 Oak Street',
        service_city: 'Austin',
        service_state: 'TX',
        service_zip: '78701',
        notes_from_customer: 'Please call before arriving. Living room TV above fireplace.',
        created_at: testOrders[0].created_at,
        metadata: {
          order_id: 'ord_test_001',
          items_json: JSON.parse(testOrders[0].items),
          estimated_payout: 104.65 // 35% of $299
        }
      },
      {
        job_id: 'job_test_002',
        status: 'completed',
        customer_name: 'Jennifer Davis',
        customer_email: 'jennifer.d@example.com',
        service_name: 'Soundbar Installation',
        service_address: '456 Pine Avenue',
        service_city: 'Dallas',
        service_state: 'TX',
        service_zip: '75201',
        notes_from_customer: 'Soundbar already purchased, just need mounting.',
        created_at: testOrders[1].created_at,
        metadata: {
          order_id: 'ord_test_002',
          items_json: JSON.parse(testOrders[1].items),
          estimated_payout: 52.15 // 35% of $149
        }
      },
      {
        job_id: 'job_test_003',
        status: 'completed',
        customer_name: 'Robert Chen',
        customer_email: 'robert.c@example.com',
        service_name: 'Home Theater Setup',
        service_address: '789 Maple Drive',
        service_city: 'Houston',
        service_state: 'TX',
        service_zip: '77002',
        notes_from_customer: 'Full home theater setup in basement. TV, soundbar, and cable hiding.',
        created_at: testOrders[2].created_at,
        metadata: {
          order_id: 'ord_test_003',
          items_json: JSON.parse(testOrders[2].items),
          estimated_payout: 173.95 // 35% of $497
        }
      },
      {
        job_id: 'job_test_004',
        status: 'completed',
        customer_name: 'Amanda White',
        customer_email: 'amanda.w@example.com',
        service_name: '85" TV Mount Installation',
        service_address: '321 Elm Boulevard',
        service_city: 'San Antonio',
        service_state: 'TX',
        service_zip: '78205',
        notes_from_customer: 'Large TV, may need 2 people. Brick wall.',
        created_at: testOrders[3].created_at,
        metadata: {
          order_id: 'ord_test_004',
          items_json: JSON.parse(testOrders[3].items),
          estimated_payout: 122.15 // 35% of $349
        }
      }
    ];

    for (const job of testJobs) {
      const { error } = await supabase.from('h2s_dispatch_jobs').upsert(job, { onConflict: 'job_id' });
      if (!error) results.created.jobs++;
    }

    // 4. Create job assignments
    const assignments = [
      { job_id: 'job_test_001', pro_id: 'pro_tabari', state: 'completed', accepted_at: testOrders[0].created_at, completed_at: new Date(new Date(testOrders[0].created_at).getTime() + 2 * 60 * 60 * 1000).toISOString() },
      { job_id: 'job_test_002', pro_id: 'pro_james', state: 'completed', accepted_at: testOrders[1].created_at, completed_at: new Date(new Date(testOrders[1].created_at).getTime() + 1.5 * 60 * 60 * 1000).toISOString() },
      { job_id: 'job_test_003', pro_id: 'pro_tabari', state: 'completed', accepted_at: testOrders[2].created_at, completed_at: new Date(new Date(testOrders[2].created_at).getTime() + 3 * 60 * 60 * 1000).toISOString() },
      { job_id: 'job_test_004', pro_id: 'pro_sarah', state: 'completed', accepted_at: testOrders[3].created_at, completed_at: new Date(new Date(testOrders[3].created_at).getTime() + 2.5 * 60 * 60 * 1000).toISOString() }
    ];

    for (const assignment of assignments) {
      const { error } = await supabase.from('h2s_dispatch_job_assignments').upsert(
        { ...assignment, assignment_id: `${assignment.job_id}_${assignment.pro_id}` },
        { onConflict: 'assignment_id' }
      );
      if (!error) results.created.assignments++;
    }

    // 5. Create job artifacts (photos)
    const artifacts = [
      { job_id: 'job_test_001', artifact_type: 'photo', artifact_url: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=800', uploaded_at: assignments[0].completed_at },
      { job_id: 'job_test_001', artifact_type: 'signature', artifact_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', uploaded_at: assignments[0].completed_at },
      { job_id: 'job_test_002', artifact_type: 'photo', artifact_url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800', uploaded_at: assignments[1].completed_at },
      { job_id: 'job_test_003', artifact_type: 'photo', artifact_url: 'https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?w=800', uploaded_at: assignments[2].completed_at },
      { job_id: 'job_test_003', artifact_type: 'photo', artifact_url: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=800', uploaded_at: assignments[2].completed_at },
      { job_id: 'job_test_004', artifact_type: 'photo', artifact_url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800', uploaded_at: assignments[3].completed_at }
    ];

    for (const artifact of artifacts) {
      const { error } = await supabase.from('h2s_dispatch_job_artifacts').insert(artifact);
      if (!error) results.created.artifacts++;
    }

    // 6. Create payouts in different states
    const payouts = [
      { 
        payout_id: 'payout_001',
        job_id: 'job_test_001', 
        pro_id: 'pro_tabari', 
        amount: 104.65, 
        state: 'pending', 
        created_at: assignments[0].completed_at,
        metadata: { customer_name: 'Michael Thompson', service_name: '75" TV Mount Installation' }
      },
      { 
        payout_id: 'payout_002',
        job_id: 'job_test_002', 
        pro_id: 'pro_james', 
        amount: 52.15, 
        state: 'approved', 
        created_at: assignments[1].completed_at,
        approved_at: new Date(new Date(assignments[1].completed_at).getTime() + 30 * 60 * 1000).toISOString(),
        metadata: { customer_name: 'Jennifer Davis', service_name: 'Soundbar Installation' }
      },
      { 
        payout_id: 'payout_003',
        job_id: 'job_test_003', 
        pro_id: 'pro_tabari', 
        amount: 173.95, 
        state: 'paid', 
        created_at: assignments[2].completed_at,
        approved_at: new Date(new Date(assignments[2].completed_at).getTime() + 1 * 60 * 60 * 1000).toISOString(),
        paid_at: new Date(new Date(assignments[2].completed_at).getTime() + 2 * 60 * 60 * 1000).toISOString(),
        metadata: { customer_name: 'Robert Chen', service_name: 'Home Theater Setup' }
      },
      { 
        payout_id: 'payout_004',
        job_id: 'job_test_004', 
        pro_id: 'pro_sarah', 
        amount: 122.15, 
        state: 'pending', 
        created_at: assignments[3].completed_at,
        metadata: { customer_name: 'Amanda White', service_name: '85" TV Mount Installation' }
      }
    ];

    for (const payout of payouts) {
      const { error } = await supabase.from('h2s_payouts_ledger').upsert(payout, { onConflict: 'payout_id' });
      if (!error) results.created.payouts++;
    }

    console.log('[seed_payout_test_data] ✅ Seeding complete:', results.created);

    return res.status(200).json(results);

  } catch (error) {
    console.error('[seed_payout_test_data] ❌ Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Failed to seed test data',
      details: error.message
    });
  }
}
