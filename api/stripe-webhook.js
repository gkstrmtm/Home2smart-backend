import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import crypto from 'crypto';

// Disable body parsing for Stripe webhook signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Read raw body as Buffer for signature verification
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks);

    // Parse the event
    let event;
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (webhookSecret && sig) {
      // Verify signature if secret is configured
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err) {
        console.error('[Stripe Webhook] Signature verification failed:', err.message);
        return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
      }
    } else {
      // Fallback: Parse JSON directly (like Apps Script does)
      console.log('[Stripe Webhook] No signature verification - parsing JSON directly');
      event = JSON.parse(rawBody.toString());
    }

    console.log('[Stripe Webhook] Event received:', event.type);

    // Initialize Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Handle checkout.session.completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      console.log('[Stripe Webhook] Checkout completed:', {
        session_id: session.id,
        customer_email: session.customer_email,
        amount_total: session.amount_total
      });

      // Extract customer data from metadata
      const customerName = session.metadata?.customer_name || session.customer_details?.name || '';
      const customerPhone = session.metadata?.customer_phone || session.customer_details?.phone || '';
      const customerEmail = session.customer_email || session.customer_details?.email || '';

      // Extract address from shipping or customer_details
      const shipping = session.shipping || session.customer_details;
      const address = session.metadata?.service_address || shipping?.address?.line1 || '';
      const city = session.metadata?.service_city || shipping?.address?.city || '';
      const state = session.metadata?.service_state || shipping?.address?.state || '';
      const zip = session.metadata?.service_zip || shipping?.address?.postal_code || '';

      // Check if order exists
      const { data: existingOrder } = await supabase
        .from('h2s_orders')
        .select('order_id')
        .eq('session_id', session.id)
        .single();

      let order;
      
      if (existingOrder) {
         // Update existing
         const { data: updated, error: updateError } = await supabase
            .from('h2s_orders')
            .update({
               payment_intent_id: session.payment_intent,
               status: 'paid',
               metadata_json: session.metadata,
               // Update address fields if missing
               address: address,
               city: city,
               state: state,
               zip: zip,
               customer_name: customerName,
               customer_phone: customerPhone
            })
            .eq('order_id', existingOrder.order_id)
            .select('order_id')
            .single();
         
         if (updateError) console.error('[Stripe Webhook] Failed to update order:', updateError);
         else console.log('[Stripe Webhook] Updated existing order:', updated.order_id);
         
         order = updated || existingOrder;
      } else {
         // Generate Order ID
         const orderId = `ORD-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;

         // Insert new (fallback)
         const { data: inserted, error: insertError } = await supabase
            .from('h2s_orders')
            .insert({
              order_id: orderId,
              session_id: session.id,
              payment_intent_id: session.payment_intent,
              customer_email: customerEmail,
              customer_name: customerName,
              customer_phone: customerPhone,
              subtotal: (session.amount_subtotal || session.amount_total) / 100, // Pre-discount amount
              total: session.amount_total / 100, // Final amount paid (after discounts)
              currency: session.currency,
              status: 'pending',
              metadata_json: session.metadata,
              created_at: new Date().toISOString(),
              // Save address fields
              address: address,
              city: city,
              state: state,
              zip: zip,
              // service_address: address, // Removed as it's not in schema
              // service_city: city,
              // service_state: state,
              // service_zip: zip
            })
            .select('order_id')
            .single();

         if (insertError) console.error('[Stripe Webhook] Failed to save order:', insertError);
         else console.log('[Stripe Webhook] Order saved:', inserted?.order_id);
         
         order = inserted;
      }

      // Prepare customer data for notifications
      const firstName = customerName.split(' ')[0] || 'there';
      const cartItems = JSON.parse(session.metadata?.cart_items || '[]');
      const itemNames = cartItems.map(item => item.name).join(', ');
      const serviceName = itemNames || 'your order';
      
      // Format cart items for receipt email
      const itemsHtml = cartItems.map(item => 
        `<div class="item-line"><span>${item.qty || 1}× ${item.name}</span><span>$${((item.price * (item.qty || 1)) / 100).toFixed(2)}</span></div>`
      ).join('');
      
      const itemsText = cartItems.map(item => 
        `${item.qty || 1}× ${item.name} - $${((item.price * (item.qty || 1)) / 100).toFixed(2)}`
      ).join('\n');
      
      const paymentConfirmationData = {
        firstName,
        amount: (session.amount_total / 100).toFixed(2),
        orderNumber: order?.order_id?.slice(0, 8).toUpperCase() || session.id.slice(-8).toUpperCase(),
        orderDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        paymentMethod: session.payment_method_types?.[0] === 'card' ? 'Credit Card' : 'Payment',
        itemsHtml,
        itemsText,
        service: serviceName,
        scheduleUrl: `https://home2smart.com/bundles?view=shopsuccess&order_id=${order?.order_id || session.id}`
      };
      
      const notificationData = {
        firstName,
        service: serviceName,
        date: 'TBD', // Will be set when appointment is scheduled
        time: 'TBD'
      };

      // Send SMS confirmation if phone number exists
      if (customerPhone && process.env.TWILIO_ENABLED === 'true') {
        try {
          const smsResponse = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://h2s-backend.vercel.app'}/api/send-sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: customerPhone,
              template_key: 'payment_confirmed',
              data: paymentConfirmationData,
              order_id: order?.order_id
            })
          });

          const smsResult = await smsResponse.json();
          console.log('[Stripe Webhook] Payment confirmation SMS sent:', smsResult);
        } catch (smsError) {
          console.error('[Stripe Webhook] Failed to send SMS:', smsError);
          // Don't fail the webhook if SMS fails
        }
      }

      // Send email confirmation if email exists
      if (session.customer_email && process.env.SENDGRID_ENABLED !== 'false') {
        try {
          const emailResponse = await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://h2s-backend.vercel.app'}/api/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: session.customer_email,
              template_key: 'payment_confirmed',
              data: paymentConfirmationData,
              order_id: order?.order_id
            })
          });

          const emailResult = await emailResponse.json();
          console.log('[Stripe Webhook] Payment confirmation email sent:', emailResult);
        } catch (emailError) {
          console.error('[Stripe Webhook] Failed to send email:', emailError);
          // Don't fail the webhook if email fails
        }
      }

      // === MANAGEMENT NOTIFICATION ===
      // Notify management of new booking
      const amountTotal = session.amount_total / 100;
      const notificationType = amountTotal >= 500 ? 'highValueOrder' : 'newBooking';
      
      try {
        await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://h2s-backend.vercel.app'}/api/notify-management`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: notificationType,
            data: {
              service: serviceName,
              customerName: customerName || 'Unknown',
              date: 'TBD',
              time: 'TBD',
              orderNumber: order?.order_id?.slice(0, 8).toUpperCase() || session.id.slice(-8).toUpperCase(),
              amount: amountTotal.toFixed(2),
              city: session.metadata?.city || 'Unknown',
              state: session.metadata?.state || 'SC',
              phone: customerPhone || 'Not provided'
            }
          })
        });
        console.log('[Stripe Webhook] Management notification sent');
      } catch (mgmtError) {
        console.error('[Stripe Webhook] Management notification failed (non-critical):', mgmtError);
      }

      // === REWARDS SYSTEM ===
      try {
        const amountPaid = session.amount_total / 100;
        const pointsEarned = Math.floor(amountPaid / 10); // 1 point per $10
        
        if (pointsEarned > 0 && customerEmail) {
          // 1. Credit the buyer
          const { data: user, error: userErr } = await supabase
            .from('h2s_users')
            .select('points_balance, total_spent')
            .eq('email', customerEmail)
            .single();
            
          if (user) {
            const newBalance = (Number(user.points_balance) || 0) + pointsEarned;
            const newTotal = (Number(user.total_spent) || 0) + amountPaid;
            
            await supabase
              .from('h2s_users')
              .update({ 
                points_balance: newBalance,
                total_spent: newTotal
              })
              .eq('email', customerEmail);
              
            console.log(`[Rewards] Awarded ${pointsEarned} points to ${customerEmail}`);
          }
        }
        
        // 2. Handle Referral (if applicable)
        // If metadata contains 'referral_code', credit the referrer
        const refCode = session.metadata?.referral_code;
        if (refCode) {
           const { data: referrer } = await supabase
             .from('h2s_users')
             .select('email, points_balance')
             .eq('referral_code', refCode)
             .single();
             
           if (referrer && referrer.email !== customerEmail) {
             // Award referrer (e.g. flat 50 points or % based)
             const referralBonus = 50; 
             const newRefBalance = (Number(referrer.points_balance) || 0) + referralBonus;
             
             await supabase
               .from('h2s_users')
               .update({ points_balance: newRefBalance })
               .eq('email', referrer.email);
               
             console.log(`[Rewards] Awarded ${referralBonus} referral points to ${referrer.email}`);
           }
        }
      } catch (rewardErr) {
        console.error('[Rewards] Failed to process rewards:', rewardErr);
        // Don't fail the webhook
      }
      
      // 🔄 AUTO-TRIGGER JOB CREATION after successful checkout
      // This creates dispatch jobs automatically without waiting for appointment scheduling
      try {
        const baseUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
        console.log('[Webhook] Triggering job creation for order:', order?.order_id);
        
        const jobResponse = await fetch(`${baseUrl}/api/create_jobs_from_orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            order_id: order?.order_id,
            auto_trigger: true,
            test_mode: false
          })
        });
        
        const jobResult = await jobResponse.json();
        if (jobResult.jobs_created > 0) {
          console.log(`[Webhook] ✅ Created ${jobResult.jobs_created} dispatch job(s)`);
        } else {
          console.warn('[Webhook] ⚠️ Job creation returned 0 jobs:', jobResult);
        }
      } catch (jobErr) {
        console.error('[Webhook] Job creation failed (non-critical):', jobErr.message);
        // Don't fail webhook - jobs can be created manually later
      }
    }

    // Handle payment_intent.succeeded
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      console.log('[Stripe Webhook] Payment succeeded:', paymentIntent.id);
      
      // Update order status
      await supabase
        .from('h2s_orders')
        .update({ 
          status: 'paid',
          payment_status: 'succeeded'
        })
        .eq('payment_intent_id', paymentIntent.id);
    }

    // Handle payment_intent.payment_failed
    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;
      console.log('[Stripe Webhook] Payment failed:', paymentIntent.id);
      
      await supabase
        .from('h2s_orders')
        .update({ 
          status: 'failed',
          payment_status: 'failed'
        })
        .eq('payment_intent_id', paymentIntent.id);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[Stripe Webhook] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
