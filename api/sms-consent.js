import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * API Endpoint: Store SMS Marketing Consent
 * 
 * Records customer consent to receive marketing text messages.
 * This is required for TCPA compliance.
 * 
 * POST /api/sms-consent
 * Body: {
 *   name: string,
 *   email: string,
 *   phone: string,
 *   consented_at: ISO timestamp,
 *   consent_type: 'marketing' | 'transactional',
 *   source: string (e.g., 'checkout_form', 'landing_page')
 * }
 */
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { name, email, phone, consented_at, consent_type, source } = req.body;

    // Validation
    if (!phone) {
      return res.status(400).json({ ok: false, error: 'Phone number is required' });
    }

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Email is required' });
    }

    // Normalize phone number (remove formatting)
    const normalizedPhone = phone.replace(/\D/g, '');

    // Check if consent already exists for this phone
    const { data: existing, error: checkError } = await supabase
      .from('sms_consents')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('consent_type', consent_type || 'marketing')
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
      console.error('[SMS Consent] Check error:', checkError);
    }

    if (existing) {
      // Update existing consent record
      const { data, error } = await supabase
        .from('sms_consents')
        .update({
          name: name || existing.name,
          email: email || existing.email,
          consented_at: consented_at || new Date().toISOString(),
          source: source || existing.source,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        console.error('[SMS Consent] Update error:', error);
        return res.status(500).json({ ok: false, error: 'Failed to update consent' });
      }

      return res.status(200).json({ 
        ok: true, 
        consent: data,
        message: 'Consent record updated'
      });
    }

    // Create new consent record
    const { data, error } = await supabase
      .from('sms_consents')
      .insert({
        name: name || null,
        email: email,
        phone: normalizedPhone,
        phone_raw: phone,
        consented_at: consented_at || new Date().toISOString(),
        consent_type: consent_type || 'marketing',
        source: source || 'unknown',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[SMS Consent] Insert error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to store consent' });
    }

    return res.status(201).json({ 
      ok: true, 
      consent: data,
      message: 'Consent recorded successfully'
    });

  } catch (err) {
    console.error('[SMS Consent] Unexpected error:', err);
    return res.status(500).json({ 
      ok: false, 
      error: 'Internal server error',
      message: err.message 
    });
  }
}
