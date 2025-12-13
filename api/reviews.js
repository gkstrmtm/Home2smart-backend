// Reviews API - Fetches and caches verified customer reviews from Supabase
// Endpoint: /api/reviews

import { createClient } from '@supabase/supabase-js';

// Cache reviews in memory for 5 minutes (faster refresh than before)
let reviewsCache = null;
let reviewsCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Google Apps Script endpoint (fallback only)
const REVIEWS_API = 'https://script.google.com/macros/s/AKfycbwJzG7HNL1B53i6_Ryqvb5zEccD-CREbiVR01MRUEnhoaXSZusT8wVj9uJfDaqqMt3D/exec';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Check cache first
    const now = Date.now();
    if (reviewsCache && (now - reviewsCacheTime) < CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600, max-age=120');
      return res.status(200).json({
        ok: true,
        reviews: reviewsCache,
        cached: true
      });
    }

    // Initialize Supabase
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

  // Query parameters
  const limit = Math.min(parseInt(req.query.limit) || 12, 50); // cap
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const onlyVerified = req.query.onlyVerified !== 'false'; // default true

    // Supabase schema now has full extended columns after migration:
    //   review_id (TEXT), rating (INT), review_text (TEXT), display_name (TEXT),
    //   customer_email (TEXT), verified (BOOL), show_name (BOOL), is_visible (BOOL),
    //   is_featured (BOOL), services_selected (TEXT), created_at (TIMESTAMPTZ), etc.
    // Filtering:
    //   is_visible = true (public display)
    //   rating >= 4 (quality gate)
    //   review_text NOT NULL and length >= 20 (quality content)
    //   verified = true if onlyVerified requested
    //
    let query = supabase
      .from('h2s_reviews')
      .select('review_id,rating,review_text,display_name,customer_name,verified,is_visible,is_featured,services_selected,created_at')
      .eq('is_visible', true)
      .gte('rating', 4)
      .not('review_text', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (onlyVerified) {
      query = query.eq('verified', true);
    }

    const { data: reviews, error } = await query;

    if (error) {
      console.error('[Reviews] Supabase error:', error.message);
      throw new Error(`Supabase query failed: ${error.message}`);
    }

    // Transform to simplified format for frontend
    let transformedReviews = (reviews || [])
      .filter(r => r.review_text && r.review_text.trim().length >= 20) // Minimum length threshold
      .map(item => ({
        name: item.display_name || item.customer_name || 'Customer',
        text: item.review_text || '',
        rating: item.rating || 5,
        service: item.services_selected || 'Home Service',
        date: item.created_at || new Date().toISOString(),
        verified: Boolean(item.verified || item.is_featured)
      }));

    // No need to slice again - range() already handles offset/limit
    
    // Update cache
    reviewsCache = transformedReviews;
    reviewsCacheTime = now;

    // Set aggressive CDN cache: 5min fresh, 1hr stale-while-revalidate
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Source', 'supabase');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600, max-age=120');

    return res.status(200).json({
      ok: true,
      reviews: transformedReviews,
      count: transformedReviews.length,
      offset,
      limit
    });

  } catch (error) {
    console.error('[Reviews] Error:', error.message);
    
    // Fallback 1: Return stale cache if available
    if (reviewsCache) {
      res.setHeader('X-Cache', 'STALE');
      res.setHeader('X-Source', 'cache-fallback');
      return res.status(200).json({
        ok: true,
        reviews: reviewsCache,
        cached: true,
        stale: true
      });
    }

    // Fallback 2: Try Google Sheets (original source)
    try {
      const limit = parseInt(req.query.limit) || 12;
      const onlyVerified = req.query.onlyVerified !== 'false';
      const url = `${REVIEWS_API}?action=public_list&limit=${limit}&offset=0&onlyVerified=${onlyVerified}`;
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.items) {
          const reviews = data.items.map(item => ({
            name: item.display_name || 'Customer',
            text: item.review_text || '',
            rating: item.rating || 5,
            service: item.services_selected || 'Home Service',
            date: item.timestamp_iso || new Date().toISOString(),
            verified: item.verified || false
          }));
          
          res.setHeader('X-Source', 'google-sheets-fallback');
          return res.status(200).json({
            ok: true,
            reviews: reviews,
            count: reviews.length,
            fallback: true
          });
        }
      }
    } catch (fallbackErr) {
      console.error('[Reviews] Fallback also failed:', fallbackErr.message);
    }

    // Final fallback: return empty
    return res.status(500).json({
      ok: false,
      error: 'Failed to fetch reviews',
      reviews: []
    });
  }
}
