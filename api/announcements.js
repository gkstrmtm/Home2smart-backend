import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// In-memory cache for announcements (with timestamp)
let cachedData = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes server-side cache

export default async function handler(req, res) {
  // CORS headers
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // CDN and browser caching
  // s-maxage = CDN/edge cache (5 min), stale-while-revalidate = serve stale while fetching fresh
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=30');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const now = Date.now();
    
    // Check server-side in-memory cache
    if (cachedData && (now - cacheTime < CACHE_TTL_MS)) {
      return res.json({
        ok: true,
        announcements: cachedData,
        cached: true,
        cache_age_seconds: Math.floor((now - cacheTime) / 1000)
      });
    }

    // Fetch fresh announcements from DB
    const [announcementsResult, viewsResult] = await Promise.all([
      supabase
        .from('h2s_dispatch_announcements')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('h2s_dispatch_announcement_views')
        .select('announcement_id, pro_id')
    ]);

    const announcements = announcementsResult.data || [];
    const views = viewsResult.data || [];

    // Build view counts map
    const viewCounts = {};
    views.forEach(v => {
      viewCounts[v.announcement_id] = (viewCounts[v.announcement_id] || 0) + 1;
    });

    // Enrich announcements with view counts
    const enriched = announcements.map(ann => ({
      ...ann,
      view_count: viewCounts[ann.announcement_id] || 0
    }));

    // Update cache
    cachedData = enriched;
    cacheTime = now;

    return res.json({
      ok: true,
      announcements: enriched,
      cached: false,
      total: enriched.length
    });

  } catch (error) {
    console.error('Announcements error:', error);
    
    // If DB fails but we have cached data, return it
    if (cachedData) {
      return res.json({
        ok: true,
        announcements: cachedData,
        cached: true,
        fallback: true,
        cache_age_seconds: Math.floor((Date.now() - cacheTime) / 1000)
      });
    }
    
    return res.status(500).json({
      ok: false,
      error: 'Failed to load announcements',
      error_code: 'server_error'
    });
  }
}
