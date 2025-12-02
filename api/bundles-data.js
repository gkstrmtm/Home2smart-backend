// === VERCEL EDGE FUNCTION: bundles-data.js ===
// Purpose: Server-side aggregation proxy to eliminate client-side waterfall loading
// Endpoint: /api/bundles-data
// Result: Single API call instead of 5+ = instant First Contentful Paint

export const config = {
  runtime: 'edge', // Use Edge Runtime for <50ms response times globally
};

const SHOP_API = 'https://h2s-backend.vercel.app/api/shop';
const REVIEWS_API = 'https://h2s-backend.vercel.app/api/reviews';

export default async function handler(req) {
  // CORS headers for client access
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'Server-Timing', // Allow client to see timing data
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=604800', // 5min fresh, 1 week stale (guarantees instant load)
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    const start = Date.now();
    
    // Parallel fetch all data sources (no waterfall)
    // Optimization: Removed cache buster (_cb) to leverage upstream CDN caching
    const [catalogRes, reviewsRes] = await Promise.all([
      fetch(`${SHOP_API}?action=catalog`).then(async res => {
        // Force read body here to include download time in timing
        const data = await res.json(); 
        return { ok: res.ok, data };
      }).catch(() => ({ ok: false, data: null })),
      
      fetch(`${REVIEWS_API}?limit=20&verified=true`).then(async res => {
        const data = await res.json();
        return { ok: res.ok, data };
      }).catch(() => ({ ok: false, data: null })),
    ]);
    
    const now = Date.now();
    const totalUpstreamTime = now - start;

    // Extract data
    const catalogData = catalogRes.ok ? catalogRes.data : { catalog: {} };
    const reviewsData = reviewsRes.ok ? reviewsRes.data : { reviews: [] };

    // Extract actual catalog object from the response wrapper
    const catalog = catalogData.catalog || {};

    // Build aggregated response
    const payload = {
      catalog: {
        services: catalog.services || [],
        serviceOptions: catalog.serviceOptions || [],
        priceTiers: catalog.priceTiers || [],
        bundles: catalog.bundles || [],
        bundleItems: catalog.bundleItems || [],
        recommendations: catalog.recommendations || [],
        memberships: catalog.memberships || [],
        membershipPrices: catalog.membershipPrices || [],
      },
      reviews: (reviewsData.reviews || []).slice(0, 20),
      meta: {
        cached_at: new Date().toISOString(),
        ttl: 300,
      },
    };

    // Add Server-Timing headers for microscopic debugging
    // We can't easily time them individually with Promise.all unless we wrap them, 
    // but totalUpstreamTime is the critical path (longest of the two).
    headers['Server-Timing'] = `upstream;dur=${totalUpstreamTime}, processing;dur=${Date.now() - now}`;

    return new Response(JSON.stringify(payload), { status: 200, headers });

  } catch (error) {
    console.error('[bundles-data] Aggregation error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to load bundle data',
        catalog: { services: [], bundles: [] },
        reviews: [],
      }), 
      { status: 500, headers }
    );
  }
}
