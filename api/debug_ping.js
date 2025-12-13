/**
 * DEBUG HEALTH CHECK ENDPOINT
 * GET /api/debug_ping
 * Returns basic health status and environment check
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.json({
    ok: true,
    ts: new Date().toISOString(),
    env: {
      hasKey: !!process.env.DEBUG_FIRE_KEY,
      hasManagerSms: !!process.env.MANAGER_SMS_LIST,
      hasManagerEmail: !!process.env.MANAGER_EMAIL_LIST
    }
  });
}

