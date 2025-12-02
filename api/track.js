import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body;
    
    // Log to console (Vercel logs)
    console.log('[Analytics]', JSON.stringify(event));

    // Optional: Fire and forget insert to Supabase if table exists
    // We don't await this to keep response fast
    /*
    supabase.from('analytics_events').insert({
      event_name: event.event,
      session_id: event.session_id,
      user_email: event.user_email,
      url: event.url,
      payload: event
    }).then(({ error }) => {
      if (error) console.error('[Analytics] DB Error:', error);
    });
    */

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[Analytics] Error:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
}
