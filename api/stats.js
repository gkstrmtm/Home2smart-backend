// Stats API - Real-time booking statistics for urgency banners
// Endpoint: /api/stats

import { createClient } from '@supabase/supabase-js';

// Cache stats for 5 minutes (balance between freshness and performance)
let statsCache = null;
let statsCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
    if (statsCache && (now - statsCacheTime) < CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=60');
      return res.status(200).json({
        ok: true,
        stats: statsCache,
        cached: true
      });
    }

    // Validate environment
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Get date 7 days ago for "this week" stats
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    // Get date 24 hours ago for "today" stats
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const oneDayAgoISO = oneDayAgo.toISOString();

    // Query bookings from h2s_orders table
    const [
      { data: weekOrders, error: weekError },
      { data: todayOrders, error: todayError },
      { data: recentOrders, error: recentError }
    ] = await Promise.all([
      // This week's bookings
      supabase
        .from('h2s_orders')
        .select('order_id, created_at')
        .gte('created_at', sevenDaysAgoISO)
        .order('created_at', { ascending: false }),
      
      // Today's bookings
      supabase
        .from('h2s_orders')
        .select('order_id, created_at')
        .gte('created_at', oneDayAgoISO)
        .order('created_at', { ascending: false }),
      
      // Most recent order (for "available now" messaging)
      supabase
        .from('h2s_orders')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
    ]);

    if (weekError || todayError || recentError) {
      console.error('[Stats] Query errors:', { weekError, todayError, recentError });
      throw new Error('Database query failed');
    }

    // Build stats object
    const stats = {
      bookings_this_week: weekOrders?.length || 0,
      bookings_today: todayOrders?.length || 0,
      last_booking_time: recentOrders?.[0]?.created_at || null,
      available_now: true, // Always show as available (service business)
      timestamp: new Date().toISOString()
    };

    // Generate dynamic messaging
    const messages = [];
    
    if (stats.bookings_this_week > 0) {
      messages.push(`${stats.bookings_this_week} installation${stats.bookings_this_week === 1 ? '' : 's'} booked this week`);
    }
    
    if (stats.bookings_today > 0) {
      messages.push(`${stats.bookings_today} booked today`);
    }

    // Calculate time since last booking for freshness
    if (stats.last_booking_time) {
      const lastBooking = new Date(stats.last_booking_time);
      const hoursSince = (now - lastBooking.getTime()) / (1000 * 60 * 60);
      
      if (hoursSince < 1) {
        messages.push('Last booking: Less than 1 hour ago');
      } else if (hoursSince < 24) {
        messages.push(`Last booking: ${Math.floor(hoursSince)} hours ago`);
      }
    }

    stats.messages = messages;
    stats.primary_message = messages[0] || 'Professional installation available';

    // Update cache
    statsCache = stats;
    statsCacheTime = now;

    // Set CDN cache headers: 5min fresh, 1hr stale-while-revalidate
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600, max-age=60');

    return res.status(200).json({
      ok: true,
      stats: stats
    });

  } catch (error) {
    console.error('[Stats] Error:', error.message);
    
    // If we have stale cache, return it
    if (statsCache) {
      res.setHeader('X-Cache', 'STALE');
      return res.status(200).json({
        ok: true,
        stats: statsCache,
        cached: true,
        stale: true
      });
    }

    // Fallback: return generic stats
    return res.status(200).json({
      ok: true,
      stats: {
        bookings_this_week: 0,
        bookings_today: 0,
        available_now: true,
        primary_message: 'Professional installation available',
        messages: ['Professional installation available'],
        timestamp: new Date().toISOString()
      },
      fallback: true
    });
  }
}
