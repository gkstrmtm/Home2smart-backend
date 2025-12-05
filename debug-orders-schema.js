require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function debugOrders() {
  console.log('--- DEBUGGING ORDERS SCHEMA ---');
  
  const { data: orders, error } = await supabase
    .from('h2s_orders')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching orders:', error);
    return;
  }

  if (orders.length === 0) {
    console.log('No orders found.');
    return;
  }

  const order = orders[0];
  console.log('Order Keys:', Object.keys(order));
  console.log('Metadata type:', typeof order.metadata);
  console.log('Metadata content:', order.metadata);
  console.log('Metadata JSON type:', typeof order.metadata_json);
  console.log('Metadata JSON content:', order.metadata_json);
}

debugOrders();
