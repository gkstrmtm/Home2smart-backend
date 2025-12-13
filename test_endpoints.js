// Test all admin endpoints
import fetch from 'node-fetch';

const API_BASE = 'https://h2s-backend.vercel.app/api';
const TOKEN = '57b6fa7f-df0e-444b-8';

// Also try with a fresh login
async function getToken() {
  try {
    const res = await fetch(`${API_BASE}/admin_login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dispatch@h2s.com',
        zip: '29649'
      })
    });
    const data = await res.json();
    if (data.ok) return data.token || data.session_id;
  } catch (err) {
    console.log('Login failed:', err.message);
  }
  return TOKEN;
}

async function testEndpoint(name, url, method = 'GET', body = null, token = TOKEN) {
  console.log(`\n=== Testing ${name} ===`);
  try {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const res = await fetch(url, options);
    const text = await res.text();
    
    console.log(`Status: ${res.status}`);
    
    try {
      const data = JSON.parse(text);
      console.log('Response:', JSON.stringify(data, null, 2));
      return data;
    } catch {
      console.log('Raw response:', text.substring(0, 200));
      return null;
    }
  } catch (err) {
    console.error(`Error:`, err.message);
    return null;
  }
}

async function main() {
  // Get fresh token
  const token = await getToken();
  console.log('Using token:', token);
  
  // Test business intelligence
  await testEndpoint(
    'Business Intelligence',
    `${API_BASE}/admin_business_intelligence`,
    'GET',
    null,
    token
  );
  
  // Test jobs list
  await testEndpoint(
    'Jobs List',
    `${API_BASE}/admin_jobs_list`,
    'POST',
    { token: token, status: 'pending', days: 30 },
    token
  );
  
  // Test payouts overview
  await testEndpoint(
    'Payouts Overview',
    `${API_BASE}/admin_payouts_overview`,
    'POST',
    { token: token },
    token
  );
}

main().catch(console.error);
