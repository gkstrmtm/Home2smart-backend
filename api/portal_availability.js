import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const config = {
  api: { bodyParser: true },
};

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const token = body?.token || req.query?.token;
    const action = body?.action || req.query?.action || 'get';

    const proId = await validateSession(token);
    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    // GET - Retrieve availability records
    if (action === 'get') {
      const { data, error } = await supabase
        .from('h2s_dispatch_pros_availability')
        .select('*')
        .eq('pro_id', proId)
        .order('date_local', { ascending: true });

      if (error) {
        console.error('[portal_availability] Get error:', error);
        return res.status(500).json({
          ok: false,
          error: 'Failed to load availability',
          error_code: 'query_error'
        });
      }

      return res.json({
        ok: true,
        rows: data || []
      });
    }

    // SET - Create new availability record
    if (action === 'set') {
      const type = body?.type || 'vacation'; // vacation, sick, personal, blocked
      const dateLocal = body?.date_local; // YYYY-MM-DD
      const dateEnd = body?.date_end; // Optional for ranges
      const reason = body?.reason || '';

      if (!dateLocal) {
        return res.status(400).json({
          ok: false,
          error: 'Missing date_local',
          error_code: 'missing_date'
        });
      }

      // Check for duplicates
      const { data: existing } = await supabase
        .from('h2s_dispatch_pros_availability')
        .select('avail_id')
        .eq('pro_id', proId)
        .eq('date_local', dateLocal)
        .maybeSingle();

      if (existing) {
        return res.json({
          ok: true,
          message: 'Date already blocked',
          avail_id: existing.avail_id
        });
      }

      // Insert new record
      const { data, error } = await supabase
        .from('h2s_dispatch_pros_availability')
        .insert({
          pro_id: proId,
          type: type,
          date_local: dateLocal,
          reason: reason,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('[portal_availability] Insert error:', error);
        return res.status(500).json({
          ok: false,
          error: 'Failed to save availability: ' + error.message,
          error_code: 'insert_error'
        });
      }

      console.log(`✅ Availability set for pro ${proId}: ${dateLocal}`);

      return res.json({
        ok: true,
        availability: data
      });
    }

    // DELETE - Remove availability record
    if (action === 'delete') {
      const availabilityId = body?.avail_id || body?.availability_id;
      
      console.log('[portal_availability] 🗑️ DELETE request:', {
        proId,
        availabilityId,
        avail_id: body?.avail_id,
        availability_id: body?.availability_id
      });

      if (!availabilityId) {
        console.error('[portal_availability] ❌ Missing availability_id');
        return res.status(400).json({
          ok: false,
          error: 'Missing availability_id',
          error_code: 'missing_id'
        });
      }

      // First, verify the record exists and belongs to this pro
      const { data: existingRecord, error: checkError } = await supabase
        .from('h2s_dispatch_pros_availability')
        .select('availability_id, pro_id, type, date_local')
        .eq('availability_id', availabilityId)
        .eq('pro_id', proId)
        .single();

      if (checkError || !existingRecord) {
        console.error('[portal_availability] ❌ Record not found or access denied:', {
          availabilityId,
          proId,
          error: checkError?.message
        });
        return res.status(404).json({
          ok: false,
          error: 'Record not found or access denied',
          error_code: 'not_found'
        });
      }

      console.log('[portal_availability] ✅ Record verified:', {
        availability_id: existingRecord.availability_id,
        type: existingRecord.type,
        date_local: existingRecord.date_local
      });

      // Delete the record
      const { error } = await supabase
        .from('h2s_dispatch_pros_availability')
        .delete()
        .eq('availability_id', availabilityId)
        .eq('pro_id', proId); // Security: ensure pro owns this record

      if (error) {
        console.error('[portal_availability] ❌ Delete error:', error);
        return res.status(500).json({
          ok: false,
          error: 'Failed to delete availability',
          error_code: 'delete_error'
        });
      }

      console.log(`[portal_availability] ✅ Availability deleted successfully: ${availabilityId} (pro: ${proId})`);

      return res.json({ 
        ok: true,
        deleted_id: availabilityId
      });
    }

    return res.status(400).json({
      ok: false,
      error: 'Invalid action. Use: get, set, or delete',
      error_code: 'invalid_action'
    });

  } catch (error) {
    console.error('[portal_availability] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
