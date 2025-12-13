import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function validateSession(token) {
  const { data, error } = await supabase
    .from('h2s_sessions')
    .select('pro_id, expires_at')
    .eq('session_id', token)
    .single();

  if (error || !data) return null;
  if (new Date() > new Date(data.expires_at)) return null;

  supabase
    .from('h2s_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', token)
    .then(() => {});

  return data.pro_id;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }

    const token = body?.token;
    const message = body?.message?.trim();

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: 'Message is required'
      });
    }

    const proId = await validateSession(token);
    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid or expired session'
      });
    }

    // Get pro name
    const { data: pro } = await supabase
      .from('h2s_pros')
      .select('first_name, last_name')
      .eq('pro_id', proId)
      .single();

    const proName = pro ? `${pro.first_name} ${pro.last_name}` : 'Unknown';

    // Insert feedback
    const { error: insertError } = await supabase
      .from('h2s_pro_feedback')
      .insert({
        pro_id: proId,
        pro_name: proName,
        message: message
      });

    if (insertError) {
      console.error('[FEEDBACK] Insert error:', insertError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to save feedback'
      });
    }

    console.log('[FEEDBACK] Saved from', proName, ':', message.substring(0, 50));

    return res.json({
      ok: true,
      message: 'Feedback submitted successfully'
    });

  } catch (error) {
    console.error('[FEEDBACK] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error'
    });
  }
}
