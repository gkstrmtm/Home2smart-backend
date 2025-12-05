require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkCustomerSchema() {
  console.log('--- CHECKING CUSTOMERS SCHEMA ---');
  
  const { data: customers, error } = await supabase
    .from('h2s_dispatch_customers')
    .select('zip')
    .limit(1);

  if (error) {
    console.error('Error fetching customers:', error);
    return;
  }

  if (customers.length > 0) {
    const zip = customers[0].zip;
    console.log('zip value:', zip);
    console.log('zip type:', typeof zip);
  } else {
    console.log('No customers found to check.');
  }
}

checkCustomerSchema();
