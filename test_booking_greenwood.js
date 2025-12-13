import 'dotenv/config';
import handler from './api/schedule-appointment.js';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Mock Response object
class MockResponse {
    constructor() {
        this.statusCode = 200;
        this.headers = {};
        this.body = null;
    }

    setHeader(key, value) {
        this.headers[key] = value;
        return this;
    }

    status(code) {
        this.statusCode = code;
        return this;
    }

    json(data) {
        this.body = data;
        return this;
    }

    end() {
        return this;
    }
}

async function runTest() {
    console.log('🚀 Starting Greenwood Booking Test...');

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    // 1. Create a Test Order
    const testId = crypto.randomUUID();
    const testOrderId = `GW-${testId.substring(0, 8)}`;
    const testSessionId = `sess_${testId}`;

    console.log(`📝 Creating test order: ${testOrderId}`);
    const { error: insertError } = await supabase
        .from('h2s_orders')
        .insert({
            order_id: testOrderId,
            session_id: testSessionId,
            customer_email: 'greenwood_test@example.com',
            customer_name: 'Greenwood Tester',
            customer_phone: '555-0199',
            subtotal: 15000,
            total: 15000,
            status: 'paid',
            created_at: new Date().toISOString(),
            items: '[]',
            options_selected: '[]',
            metadata_json: {},
            // Address details for Greenwood (using correct columns for h2s_orders)
            address: '100 Main St',
            city: 'Greenwood',
            state: 'SC',
            zip: '29649',
            service_name: 'TV Mounting 55"'
        });

    if (insertError) {
        console.error('❌ Failed to insert test order:', insertError);
        process.exit(1);
    }

    // 2. Prepare Request
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + Math.floor(Math.random() * 10) + 5); // Random future date (5-15 days out)
    const dateStr = tomorrow.toISOString().split('T')[0];
    
    const req = {
        headers: { origin: 'http://localhost' },
        method: 'POST',
        body: {
            order_id: testSessionId,
            delivery_date: dateStr,
            delivery_time: '10:00 AM - 12:00 PM',
            start_iso: `${dateStr}T15:00:00.000Z`,
            end_iso: `${dateStr}T17:00:00.000Z`,
            timezone: 'America/New_York',
            // Manually provide Greenwood coordinates to bypass geocoding failure
            lat: 34.1712,
            lng: -82.1540
        }
    };

    const res = new MockResponse();

    // 3. Run Handler
    console.log('⚡ Invoking handler...');
    try {
        await handler(req, res);
        console.log('✅ Handler finished.');
        console.log('Response Status:', res.statusCode);
        console.log('Response Body:', res.body);

        if (res.statusCode === 200) {
            // 4. Verify Database
            console.log('🔍 Verifying h2s_dispatch_jobs...');
            const { data: job, error: jobError } = await supabase
                .from('h2s_dispatch_jobs')
                .select('*')
                .eq('order_id', testSessionId)
                .single();

            if (jobError) {
                console.error('❌ Job not found in DB:', jobError);
            } else {
                console.log('✅ Job created successfully!');
                console.log(`   Job ID: ${job.job_id}`);
                console.log(`   Status: ${job.status}`);
                console.log(`   Coordinates: ${job.geo_lat}, ${job.geo_lng}`);
                
                if (job.geo_lat && job.geo_lng) {
                    console.log('🎉 SUCCESS: Job has coordinates!');
                } else {
                    console.error('⚠️ FAILURE: Job missing coordinates!');
                }
            }
        } else {
            console.error('❌ Handler returned error status');
        }

    } catch (e) {
        console.error('💥 Exception during test:', e);
    }
}

runTest();
