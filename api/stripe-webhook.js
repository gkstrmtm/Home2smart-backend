import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[Stripe Webhook] Missing STRIPE_WEBHOOK_SECRET');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Verify webhook signature
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
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
      const customerName = session.metadata?.customer_name || '';
      const customerPhone = session.metadata?.customer_phone || '';
      const customerEmail = session.customer_email || '';

      // Save order to database
      const { data: order, error: orderError } = await supabase
        .from('h2s_orders')
        .insert({
          stripe_session_id: session.id,
          stripe_payment_intent: session.payment_intent,
          customer_email: customerEmail,
          customer_name: customerName,
          customer_phone: customerPhone,
          amount_total: session.amount_total,
          currency: session.currency,
          status: 'pending',
          metadata: session.metadata,
          created_at: new Date().toISOString()
        })
        .select('order_id')
        .single();

      if (orderError) {
        console.error('[Stripe Webhook] Failed to save order:', orderError);
      } else {
        console.log('[Stripe Webhook] Order saved:', order.order_id);
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
        .eq('stripe_payment_intent', paymentIntent.id);
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
        .eq('stripe_payment_intent', paymentIntent.id);
    }

    return res.status(200).json({ received: true });

  } catch (error) {
    console.error('[Stripe Webhook] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
