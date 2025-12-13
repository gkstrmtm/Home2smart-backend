import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Missing admin token' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validate admin session
    const { data: session } = await supabase
      .from('h2s_dispatch_admin_sessions')
      .select('session_id, expires_at')
      .eq('session_id', token)
      .single();

    if (!session || new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ ok: false, error: 'Invalid or expired admin token' });
    }

    // Fetch all pros from h2s_pros table (try both tables)
    const [prosMainResult, prosDispatchResult] = await Promise.allSettled([
      supabase.from('h2s_pros').select('pro_id, name, email, phone, status, created_at').order('created_at', { ascending: false }),
      supabase.from('h2s_dispatch_pros').select('pro_id, pro_name, pro_email, created_at').order('created_at', { ascending: false })
    ]);

    let pros = [];
    
    // Merge results from both tables
    if (prosMainResult.status === 'fulfilled' && prosMainResult.value.data) {
      pros = prosMainResult.value.data.map(p => ({
        pro_id: p.pro_id,
        pro_name: p.name,
        pro_email: p.email,
        pro_phone: p.phone,
        status: p.status,
        created_at: p.created_at,
        source: 'h2s_pros'
      }));
    }
    
    // Add pros from dispatch_pros table that aren't already in main list
    if (prosDispatchResult.status === 'fulfilled' && prosDispatchResult.value.data) {
      const existingIds = new Set(pros.map(p => p.pro_id));
      prosDispatchResult.value.data.forEach(p => {
        if (!existingIds.has(p.pro_id)) {
          pros.push({
            pro_id: p.pro_id,
            pro_name: p.pro_name,
            pro_email: p.pro_email,
            pro_phone: null,
            status: null,
            created_at: p.created_at,
            source: 'h2s_dispatch_pros'
          });
        }
      });
    }

    console.log('[admin_pros_list] Loaded', pros.length, 'pros from both tables');

    return res.status(200).json({
      ok: true,
      pros: pros
    });

  } catch (err) {
    console.error('[admin_pros_list] Exception:', err);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error',
      details: err.message 
    });
  }
}
