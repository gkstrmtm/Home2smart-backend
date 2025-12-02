/**
 * Training Admin Endpoint
 * Handles CRUD operations for training videos
 * Actions: create, update, delete, move
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://ulbzmgmxrqyipclrbohi.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsYnptZ214cnF5aXBjbHJib2hpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzA1MDE3OSwiZXhwIjoyMDc4NjI2MTc5fQ.LdMPrz04SRxAJgin-vAgABi4vd8uUiKqjWZ6ZJ1t9B4'
);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query.action || req.body?.action;

  if (!action) {
    return res.status(400).json({ ok: false, error: 'Missing action parameter' });
  }

  try {
    // ===================
    // ACTION: CREATE
    // ===================
    if (action === 'create') {
      const videoData = req.body.video;
      
      if (!videoData || !videoData.video_id || !videoData.title) {
        return res.status(400).json({ error: 'Missing required fields: video_id, title' });
      }

      const { data, error } = await supabase
        .from('h2s_training_videos')
        .insert([videoData])
        .select();

      if (error) throw error;

      return res.json({ ok: true, video: data[0] });
    }

    // ===================
    // ACTION: UPDATE
    // ===================
    if (action === 'update') {
      const { video_id, updates } = req.body;
      
      if (!video_id || !updates) {
        return res.status(400).json({ error: 'Missing video_id or updates' });
      }

      const { data, error } = await supabase
        .from('h2s_training_videos')
        .update(updates)
        .eq('video_id', video_id)
        .select();

      if (error) throw error;

      return res.json({ ok: true, video: data[0] });
    }

    // ===================
    // ACTION: DELETE
    // ===================
    if (action === 'delete') {
      const { video_id } = req.body;
      
      if (!video_id) {
        return res.status(400).json({ error: 'Missing video_id' });
      }

      const { error } = await supabase
        .from('h2s_training_videos')
        .delete()
        .eq('video_id', video_id);

      if (error) throw error;

      return res.json({ ok: true });
    }

    // ===================
    // ACTION: MOVE (change category/module)
    // ===================
    if (action === 'move') {
      const { video_id, module } = req.body;
      
      if (!video_id || !module) {
        return res.status(400).json({ error: 'Missing video_id or module' });
      }

      const { data, error } = await supabase
        .from('h2s_training_videos')
        .update({ module })
        .eq('video_id', video_id)
        .select();

      if (error) throw error;

      return res.json({ ok: true, video: data[0] });
    }

    return res.status(400).json({ ok: false, error: 'Invalid action: ' + action });

  } catch (error) {
    console.error('Training admin error:', error);
    return res.status(500).json({ 
      ok: false,
      error: error.message,
      details: error.toString()
    });
  }
}
