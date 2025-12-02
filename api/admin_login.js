/**
 * Admin Login Endpoint (Vercel)
 * POST /api/admin_login
 * 
 * Validates admin credentials and creates session in h2s_dispatch_admin_sessions
 * 
 * Input:
 *   - email: Admin email (dispatch@h2s.com)
 *   - zip: Admin ZIP code (29649)
 * 
 * Output:
 *   - { ok: true, token: "session_id", role: "admin" }
 *   - { ok: false, error: "...", error_code: "..." }
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Admin credentials (hardcoded for security - only these exact values work)
const ADMIN_EMAIL = 'dispatch@h2s.com';
const ADMIN_ZIP = '29649';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get parameters (support both GET and POST)
    const { email, zip } = req.method === 'POST' ? req.body : req.query;

    console.log('[admin_login] Attempt:', email, '/', zip);

    // Validate input
    if (!email || !zip) {
      console.log('[admin_login] Missing credentials');
      return res.status(400).json({
        ok: false,
        error: 'Email and ZIP required',
        error_code: 'missing_credentials'
      });
    }

    // Validate admin credentials (exact match, case-insensitive email)
    const emailLower = String(email).trim().toLowerCase();
    const zipTrimmed = String(zip).trim();

    if (emailLower !== ADMIN_EMAIL.toLowerCase() || zipTrimmed !== ADMIN_ZIP) {
      console.log('[admin_login] Invalid credentials');
      return res.status(401).json({
        ok: false,
        error: 'Not authorized',
        error_code: 'invalid_credentials'
      });
    }

    console.log('[admin_login] ✅ Credentials valid, creating session...');

    // Create admin session in database
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    const { data: sessionData, error: sessionError } = await supabase
      .from('h2s_dispatch_admin_sessions')
      .insert({
        admin_email: emailLower,
        issued_at: now,
        expires_at: expiresAt,
        last_seen_at: now
      })
      .select('session_id')
      .single();

    if (sessionError) {
      console.error('[admin_login] Session creation error:', sessionError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create session',
        error_code: 'session_creation_failed',
        details: sessionError.message
      });
    }

    console.log('[admin_login] ✅ Session created:', sessionData.session_id);

    // Return success with session_id as token
    return res.status(200).json({
      ok: true,
      token: sessionData.session_id,
      role: 'admin'
    });

  } catch (error) {
    console.error('[admin_login] Unexpected error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error',
      error_code: 'internal_error',
      details: error.message
    });
  }
}
