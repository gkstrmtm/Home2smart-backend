const {createClient} = require('@supabase/supabase-js');
require('dotenv').config();

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

s.from('h2s_dispatch_job_lines')
  .select('*')
  .eq('job_id', 'a0d93d27-b971-4d22-b16a-c48468e4ef2c')
  .then(({data, error}) => {
    if (error) {
      console.error(error);
    } else {
      console.log('Line Items:', data.length);
      data.forEach((l, i) => {
        console.log(`${i+1}. ${l.title} - Qty: ${l.qty} - Service: ${l.service_id}`);
      });
    }
    process.exit(0);
  });
