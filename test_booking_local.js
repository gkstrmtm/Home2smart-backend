import 'dotenv/config';
import handler from './api/schedule-appointment.js';
import { createClient } from '@supabase/supabase-js';

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
    console.log('🚀 Starting Local Handler Test...');

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

    // 1. Create a Test Order (needed for foreign key constraint)
    const testId = crypto.randomUUID();
    const testOrderId = `LOCAL-${testId.substring(0, 8)}`;
    const testSessionId = `sess_${testId}`;

    console.log(`📝 Creating test order: ${testOrderId}`);
    const { error: insertError } = await supabase
        .from('h2s_orders')
        .insert({
            order_id: testOrderId,
            session_id: testSessionId,
            customer_email: 'test_local@example.com',
            customer_name: 'Local Test User',
            subtotal: 10000,
            total: 10000,
            status: 'paid',
            created_at: new Date().toISOString(),
            items: '[]', // Empty array string as seen in sample
            options_selected: '[]',
            metadata_json: {}
        });

    if (insertError) {
        console.error('❌ Failed to insert test order:', insertError);
        process.exit(1);
    }

    // 2. Prepare Request
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
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
            timezone: 'America/New_York'
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
                .eq('order_id', testSessionId) // Assuming the handler writes session_id to order_id column
                .single();

            if (jobError) {
                console.error('❌ Verification Failed:', jobError);
            } else if (job) {
                console.log('✅ SUCCESS! Job found in DB:', job);
            } else {
                console.log('❌ Job not found (no error, but no data).');
            }
        }

    } catch (err) {
        console.error('❌ Handler crashed:', err);
    }
}

runTest();
