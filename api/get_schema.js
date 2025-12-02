/**
 * Get actual h2s_orders table schema from Supabase
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Query with service role to get schema info
    const { data, error } = await supabase
      .from('h2s_orders')
      .select('*')
      .limit(0);  // Don't return data, just check columns

    if (error) {
      // Error message will reveal column names
      return res.status(200).json({
        ok: true,
        message: 'Error reveals schema info',
        error: error.message,
        hint: error.hint || 'No hint available'
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'Table exists and is accessible',
      columns: 'Check error message or insert attempt'
    });

  } catch (error) {
    console.error('[get_schema] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
