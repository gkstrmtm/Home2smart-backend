require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkCustomerIdType() {
  console.log('--- CHECKING CUSTOMER ID TYPE ---');
  
  // Try to filter by a dummy UUID. If column is text, this might work or fail depending on operator.
  // But we want to know the type.
  // We can try to select casting to uuid.
  
  const { data, error } = await supabase
    .from('h2s_dispatch_customers')
    .select('customer_id')
    .limit(1);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (data.length > 0) {
    console.log('Sample ID:', data[0].customer_id);
    // In JS it's always string.
    
    // Let's try a raw query via rpc if possible, or just infer from the error.
    // The error `text = uuid` strongly suggests the column is text.
  }
}

checkCustomerIdType();
