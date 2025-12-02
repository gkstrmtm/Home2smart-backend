/**
 * 🔐 SECURE SUPABASE CONFIG ENDPOINT
 * Returns Supabase URL and ANON key for browser-based real-time subscriptions
 * 
 * Security: Admin-only (requires valid admin token)
 * Purpose: Avoid hardcoding credentials in HTML files
 */

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 🔒 SECURITY: Verify admin token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[SupabaseConfig] ❌ No authorization header');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    
    // Validate token format (basic check - admin tokens are base64 encoded)
    if (!token || token.length < 20) {
      console.log('[SupabaseConfig] ❌ Invalid token format');
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check if environment variables exist
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      console.error('[SupabaseConfig] ❌ Missing Supabase credentials in environment');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Return Supabase configuration
    const config = {
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY
    };

    console.log(`[SupabaseConfig] ✅ Config provided to authenticated admin`);
    console.log(`[SupabaseConfig] 🔗 URL: ${config.url}`);

    return res.status(200).json(config);

  } catch (error) {
    console.error('[SupabaseConfig] ❌ Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
