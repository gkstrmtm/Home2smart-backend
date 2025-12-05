/**
 * Unified Training Endpoint
 * Handles all training operations: catalog, progress, heartbeat, complete
 * Query param: ?action=catalog|progress|heartbeat|complete
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action || req.body?.action;

  if (!action) {
    return res.status(400).json({ ok: false, error: 'Missing action parameter' });
  }

  try {
    // ===================
    // ACTION: CATALOG
    // ===================
    if (action === 'catalog') {
      const { data: videos, error } = await supabase
        .from('h2s_training_videos')
        .select('*')
        .eq('visible', true)
        .order('module')
        .order('order_num');

      if (error) throw error;

      // Group videos by module
      const modules = {};
      (videos || []).forEach(v => {
        if (!modules[v.module]) {
          modules[v.module] = {
            name: v.module,
            videos: []
          };
        }
        modules[v.module].videos.push(v);
      });

      return res.json({
        ok: true,
        videos: videos || [],
        modules: Object.values(modules)
      });
    }

    // ===================
    // ACTION: CHINA CATALOG (region-safe URLs)
    // ===================
    if (action === 'china_catalog') {
      // Fetch videos tagged for China region or with mirror URLs
      const { data: videos, error } = await supabase
        .from('h2s_training_videos')
        .select('*')
        .eq('visible', true)
        .in('region', ['china', 'global'])
        .order('module')
        .order('order_num');

      if (error) throw error;

      // Normalize URL selection: prefer `cn_url` then `mirror_url` then `url`
      const normalized = (videos || []).map(v => ({
        video_id: v.video_id,
        title: v.title,
        module: v.module,
        duration_sec: v.duration_sec || 0,
        thumbnail_url: v.thumbnail_url || v.thumb || null,
        url: v.cn_url || v.mirror_url || v.url,
        region: v.region || 'global',
        order_num: v.order_num || 0,
        description: v.description || ''
      })).filter(v => !!v.url);

      // Group by module for UI consumption
      const modules = {};
      normalized.forEach(v => {
        if (!modules[v.module]) modules[v.module] = { name: v.module, videos: [] };
        modules[v.module].videos.push(v);
      });

      return res.json({ ok: true, videos: normalized, modules: Object.values(modules) });
    }

    // ===================
    // ACTION: PROGRESS
    // ===================
    if (action === 'progress') {
      const { token } = req.body || {};
      if (!token) return res.status(401).json({ error: 'No token provided' });

      // Get session
      const { data: sessions, error: sessErr } = await supabase
        .from('h2s_sessions')
        .select('pro_id')
        .eq('session_id', token)
        .limit(1);

      if (sessErr || !sessions || sessions.length === 0) {
        return res.status(401).json({ error: 'Invalid session' });
      }

      const proId = sessions[0].pro_id;

      // Get all progress for this pro
      const { data: progress, error: progErr } = await supabase
        .from('h2s_training_progress')
        .select('*')
        .eq('pro_id', proId);

      if (progErr) throw progErr;

      return res.json({ ok: true, progress });
    }

    // ===================
    // ACTION: HEARTBEAT
    // ===================
    if (action === 'heartbeat') {
      const { token, video_id, position_sec, duration_sec, watch_time_delta } = req.body || {};
      if (!token) return res.status(401).json({ ok: false, error: 'No token provided' });
      if (!video_id) return res.status(400).json({ ok: false, error: 'Missing video_id' });

      // Get session
      const { data: sessions, error: sessErr } = await supabase
        .from('h2s_sessions')
        .select('pro_id')
        .eq('session_id', token)
        .limit(1);

      if (sessErr || !sessions || sessions.length === 0) {
        return res.status(401).json({ ok: false, error: 'Invalid session' });
      }

      const proId = sessions[0].pro_id;
      const positionSec = position_sec || 0;
      const durationSec = duration_sec || 0;
      const watchDelta = watch_time_delta || 0;

      // Check if record exists
      const { data: existing } = await supabase
        .from('h2s_training_progress')
        .select('*')
        .eq('pro_id', proId)
        .eq('video_id', video_id)
        .limit(1);

      const now = new Date().toISOString();
      let totalWatchTime = watchDelta;
      let isCompleted = false;

      if (existing && existing.length > 0) {
        // Accumulate watch time
        totalWatchTime = (existing[0].total_watch_time || 0) + watchDelta;
        
        // Auto-complete if position >= 95% of duration
        if (durationSec > 0 && positionSec >= durationSec * 0.95) {
          isCompleted = true;
        }

        // Update progress
        const updateData = {
          position_sec: positionSec,
          duration_sec: durationSec,
          total_watch_time: totalWatchTime,
          last_watched_at: now
        };

        if (isCompleted && !existing[0].completed) {
          updateData.completed = true;
          updateData.completed_at = now;
        }

        const { error: updateErr } = await supabase
          .from('h2s_training_progress')
          .update(updateData)
          .eq('pro_id', proId)
          .eq('video_id', video_id);

        if (updateErr) throw updateErr;
      } else {
        // Create new progress record
        const insertData = {
          pro_id: proId,
          video_id,
          position_sec: positionSec,
          duration_sec: durationSec,
          total_watch_time: totalWatchTime,
          completed: isCompleted,
          last_watched_at: now
        };

        if (isCompleted) {
          insertData.completed_at = now;
        }

        const { error: insertErr } = await supabase
          .from('h2s_training_progress')
          .insert(insertData);

        if (insertErr) throw insertErr;
      }

      return res.json({ 
        ok: true, 
        position_sec: positionSec,
        total_watch_time: totalWatchTime,
        completed: isCompleted
      });
    }

    // ===================
    // ACTION: COMPLETE
    // ===================
    if (action === 'complete') {
      const { token, video_id } = req.body || {};
      if (!token) return res.status(401).json({ error: 'No token provided' });
      if (!video_id) return res.status(400).json({ error: 'Missing video_id' });

      // Get session
      const { data: sessions, error: sessErr } = await supabase
        .from('h2s_sessions')
        .select('pro_id')
        .eq('session_id', token)
        .limit(1);

      if (sessErr || !sessions || sessions.length === 0) {
        return res.status(401).json({ error: 'Invalid session' });
      }

      const proId = sessions[0].pro_id;

      // Check if record exists
      const { data: existing } = await supabase
        .from('h2s_training_progress')
        .select('*')
        .eq('pro_id', proId)
        .eq('video_id', video_id)
        .limit(1);

      if (existing && existing.length > 0) {
        // Update to completed
        const { error: updateErr } = await supabase
          .from('h2s_training_progress')
          .update({
            completed: true,
            completed_at: new Date().toISOString()
          })
          .eq('pro_id', proId)
          .eq('video_id', video_id);

        if (updateErr) throw updateErr;
      } else {
        // Create completed record
        const { error: insertErr } = await supabase
          .from('h2s_training_progress')
          .insert({
            pro_id: proId,
            video_id,
            progress_seconds: 0,
            completed: true,
            completed_at: new Date().toISOString()
          });

        if (insertErr) throw insertErr;
      }

      return res.json({ ok: true });
    }

    // Unknown action
    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('[portal_training] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
