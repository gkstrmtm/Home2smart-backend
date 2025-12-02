/**
 * Retrieve Stripe session details after successful checkout
 * Updates order with service address from Stripe
 */
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { session_id } = req.query;

  if (!session_id) {
    return res.status(400).json({
      ok: false,
      error: 'session_id required'
    });
  }

  try {
    // Retrieve full session from Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['customer_details', 'shipping_details']
    });

    if (!session) {
      return res.status(404).json({
        ok: false,
        error: 'Session not found'
      });
    }

    const orderId = session.metadata?.order_id;
    if (!orderId) {
      return res.status(400).json({
        ok: false,
        error: 'No order_id in session metadata'
      });
    }

    // Extract service address from shipping_details
    const shipping = session.shipping_details;
    const address = shipping?.address;

    if (!address) {
      console.log('[update_order_address] No shipping address collected');
      return res.status(200).json({
        ok: true,
        message: 'No address to update',
        order_id: orderId
      });
    }

    // Update all rows for this order with the service address
    const { error: updateError } = await supabase
      .from('h2s_orders')
      .update({
        service_address: address.line1 + (address.line2 ? ' ' + address.line2 : ''),
        service_city: address.city,
        service_state: address.state,
        service_zip: address.postal_code,
        customer_name: shipping.name || session.customer_details?.name,
        customer_phone: shipping.phone || session.customer_details?.phone
      })
      .eq('order_id', orderId);

    if (updateError) {
      console.error('[update_order_address] Update failed:', updateError);
      return res.status(500).json({
        ok: false,
        error: updateError.message
      });
    }

    console.log('[update_order_address] Updated order', orderId, 'with address:', address.city, address.state);

    return res.status(200).json({
      ok: true,
      order_id: orderId,
      address: {
        street: address.line1,
        city: address.city,
        state: address.state,
        zip: address.postal_code
      }
    });

  } catch (error) {
    console.error('[update_order_address] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
