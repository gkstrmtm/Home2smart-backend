import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const config = {
  api: {
    bodyParser: true,
  },
};

/**
 * Generate unique pro ID (UUID format)
 */
function generateProId() {
  return crypto.randomUUID();
}

/**
 * Generate URL slug from name
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Geocode address using Google Maps API
 */
async function geocode(address) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('No Google Maps API key configured');
    return { lat: null, lng: null };
  }
  
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.status === 'OK' && data.results?.length > 0) {
      const location = data.results[0].geometry.location;
      return { lat: location.lat, lng: location.lng };
    }
  } catch (err) {
    console.error('Geocoding error:', err);
  }
  
  return { lat: null, lng: null };
}

export default async function handler(req, res) {
  console.log('=== SIGNUP REQUEST ===');
  console.log('Method:', req.method);
  console.log('Body:', req.body);
  
  // CORS - Allow all origins
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Parse body
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    
    const { name, email, email_confirm, phone, address, city, state, zip } = body || {};

    // Email validation function
    function isValidEmail(email) {
      if (!email || typeof email !== 'string') return false;
      const trimmed = email.trim().toLowerCase();
      if (trimmed.length === 0 || trimmed.includes(' ')) return false;
      // Reasonable email regex (allows most valid formats, not overly strict)
      const emailRegex = /^[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/;
      return emailRegex.test(trimmed);
    }

    // Validation
    if (!name || !email || !phone || !address || !city || !state || !zip) {
      console.log('Missing required fields');
      return res.status(400).json({
        ok: false,
        error: 'All fields are required',
        error_code: 'missing_fields'
      });
    }

    // Email format validation
    if (!isValidEmail(email)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid email format. Please check for spaces or typos.',
        error_code: 'invalid_email'
      });
    }

    // Email confirmation check (if provided)
    if (email_confirm && email.trim().toLowerCase() !== email_confirm.trim().toLowerCase()) {
      return res.status(400).json({
        ok: false,
        error: 'Email addresses do not match',
        error_code: 'email_mismatch'
      });
    }

    // Check if email already exists
    const { data: existing, error: checkError } = await supabase
      .from('h2s_pros')
      .select('email')
      .eq('email', email.trim().toLowerCase())
      .limit(1);

    if (checkError) {
      console.error('Database check error:', checkError);
      return res.status(500).json({
        ok: false,
        error: 'Database error',
        error_code: 'db_error'
      });
    }

    if (existing && existing.length > 0) {
      console.log('Email already exists:', email);
      return res.status(409).json({
        ok: false,
        error: 'An account with this email already exists. Try logging in instead.',
        error_code: 'duplicate_email'
      });
    }

    // Generate IDs
    const proId = generateProId();
    const slug = slugify(name);
    
    // Geocode address
    const fullAddress = `${address}, ${city}, ${state} ${zip}`;
    console.log('Geocoding:', fullAddress);
    const { lat, lng } = await geocode(fullAddress);
    console.log('Geocoded to:', { lat, lng });

    // Create pro record
    const proData = {
      pro_id: proId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      home_address: address.trim(),
      home_city: city.trim(),
      home_state: state.trim(),
      home_zip: zip.trim(),
      geo_lat: lat,
      geo_lng: lng,
      slug: slug,
      status: 'pending',
      email_confirmed: email_confirm ? (email.trim().toLowerCase() === email_confirm.trim().toLowerCase()) : false,
      service_radius_miles: 35,
      max_jobs_per_day: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('Creating pro:', proData.pro_id);

    const { data: newPro, error: insertError } = await supabase
      .from('h2s_pros')
      .insert(proData)
      .select()
      .single();

    if (insertError) {
      console.error('Pro creation failed:', insertError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create account: ' + insertError.message,
        error_code: 'insert_error'
      });
    }

    console.log('Pro created successfully!');

    // Create session
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    console.log('Creating session:', sessionId);

    const { error: sessionError } = await supabase
      .from('h2s_sessions')
      .insert({
        session_id: sessionId,
        pro_id: proId,
        expires_at: expiresAt.toISOString(),
        last_seen_at: new Date().toISOString()
      });

    if (sessionError) {
      console.error('Session creation failed:', sessionError);
      // Don't fail signup if session creation fails
      console.warn('Signup succeeded but session failed - user will need to login');
    }

    // Send welcome email (only if email is confirmed/valid)
    // Migrate from Apps Script to Vercel endpoint
    try {
      // Only send if email is confirmed (double-entry match) or if no confirmation was required
      const shouldSendEmail = !email_confirm || email.trim().toLowerCase() === email_confirm.trim().toLowerCase();
      
      if (shouldSendEmail && isValidEmail(email.trim().toLowerCase())) {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://h2s-backend.vercel.app';
        
        await fetch(`${baseUrl}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to_email: email.trim().toLowerCase(),
            template_key: 'pro_welcome',
            data: {
              firstName: name.trim().split(' ')[0],
              name: name.trim()
            },
            user_id: null, // Pro signup, not customer
            order_id: null
          })
        });
        console.log('Welcome email sent');
      } else {
        console.log('Welcome email skipped - email not confirmed or invalid');
      }
    } catch (emailErr) {
      console.warn('Welcome email failed:', emailErr);
      // Don't fail signup if email fails
    }

    return res.json({
      ok: true,
      token: sessionId,
      pro: {
        pro_id: proId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        home_address: address.trim(),
        home_city: city.trim(),
        home_state: state.trim(),
        home_zip: zip.trim(),
        geo_lat: lat,
        geo_lng: lng,
        vehicle_text: '',
        service_radius_miles: 35,
        max_jobs_per_day: 3,
        photo_url: '',
        bio_short: '',
        status: 'pending',
        slug: slug
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
