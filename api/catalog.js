import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Cache catalog in memory for 5 minutes
let catalogCache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export default async function handler(req, res) {
  // CORS headers
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only support GET
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // Check cache first
    const now = Date.now();
    if (catalogCache && (now - cacheTime) < CACHE_TTL) {
      console.log('[Catalog] Serving from cache');
      return res.status(200).json({
        ok: true,
        catalog: catalogCache,
        cached: true
      });
    }

    console.log('[Catalog] Loading from Supabase...');

    // Load catalog from Supabase in parallel
    const [
      { data: services, error: servicesError },
      { data: bundles, error: bundlesError },
      { data: priceTiers, error: tiersError },
      { data: serviceOptions, error: optionsError },
      { data: bundleItems, error: itemsError }
    ] = await Promise.all([
      supabase.from('h2s_services').select('*').order('service_id'),
      supabase.from('h2s_bundles').select('*').eq('active', true).order('bundle_id'),
      supabase.from('h2s_pricetiers').select('*').order('service_id, min_qty'),
      supabase.from('h2s_serviceoptions').select('*').order('service_id, option_id'),
      supabase.from('h2s_bundleitems').select('*').order('bundle_id, service_id')
    ]);

    // Check for errors
    const errors = [
      servicesError && 'services: ' + servicesError.message,
      bundlesError && 'bundles: ' + bundlesError.message,
      tiersError && 'priceTiers: ' + tiersError.message,
      optionsError && 'serviceOptions: ' + optionsError.message,
      itemsError && 'bundleItems: ' + itemsError.message
    ].filter(Boolean);

    if (errors.length > 0) {
      console.error('[Catalog] Load errors:', errors);
      return res.status(500).json({
        ok: false,
        error: 'Failed to load catalog',
        details: errors
      });
    }

    // Build catalog object
    const catalog = {
      services: services || [],
      bundles: bundles || [],
      priceTiers: priceTiers || [],
      serviceOptions: serviceOptions || [],
      bundleItems: bundleItems || [],
      recommendations: [], // Could load from DB later
      memberships: [], // Could load from DB later
      membershipPrices: [], // Could load from DB later
      config: { currency: 'usd' }
    };

    // Update cache
    catalogCache = catalog;
    cacheTime = now;

    console.log('[Catalog] Loaded:', {
      services: catalog.services.length,
      bundles: catalog.bundles.length,
      priceTiers: catalog.priceTiers.length
    });

    // Set cache headers for CDN (5 minute cache, 1 day stale-while-revalidate)
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');

    return res.status(200).json({
      ok: true,
      catalog,
      cached: false
    });

  } catch (error) {
    console.error('[Catalog] Error:', error);
    
    // If we have stale cache, return it with warning
    if (catalogCache) {
      console.log('[Catalog] Returning stale cache due to error');
      return res.status(200).json({
        ok: true,
        catalog: catalogCache,
        cached: true,
        stale: true,
        error: error.message
      });
    }

    return res.status(500).json({
      ok: false,
      error: error.message || 'Failed to load catalog'
    });
  }
}
