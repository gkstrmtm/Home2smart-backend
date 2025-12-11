import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ulbzmgmxrqyipclrbohi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsYnptZ214cnF5aXBjbHJib2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwNTAxNzksImV4cCI6MjA3ODYyNjE3OX0.zDbEkHwnTu5bjqUEyetqIYqdN6ipp15X372-a8ptCB4';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log('--- RESETTING LEDGER TO PENDING ---');

  // 1. Find the Pro ID
  const partialToken = '57b6fa7f-df0e-444b-8'; 
  const { data: sessions } = await supabase
    .from('h2s_sessions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  const session = sessions.find(s => s.session_id.startsWith(partialToken));
  if (!session) { console.error('No matching session found.'); return; }
  const proId = session.pro_id;
  console.log(`Pro ID: ${proId}`);

  // 2. Update all 'approved' entries to 'pending' for this pro
  const { data, error } = await supabase
    .from('h2s_payouts_ledger')
    .update({ state: 'pending' })
    .eq('pro_id', proId)
    .eq('state', 'approved')
    .select();

  if (error) {
    console.error('Error updating ledger:', error);
  } else {
    console.log(`Successfully reset ${data.length} entries to 'pending'.`);
    console.log('The user should now see these as "Pending Approval" in the portal.');
  }
}

run();
