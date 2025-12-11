import fetch from 'node-fetch';

const API_BASE = 'https://h2s-backend.vercel.app/api';

async function testPayouts() {
  // Login first
  const loginRes = await fetch(`${API_BASE}/admin_login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'dispatch@h2s.com',
      zip: '29649'
    })
  });
  
  const loginData = await loginRes.json();
  const token = loginData.token || loginData.session_id;
  
  console.log('Token:', token);
  
  // Test payouts
  const payoutsRes = await fetch(`${API_BASE}/admin_payouts_overview`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ token })
  });
  
  const payoutsData = await payoutsRes.json();
  
  console.log('Status:', payoutsRes.status);
  console.log('Response:', JSON.stringify(payoutsData, null, 2));
}

testPayouts().catch(console.error);
