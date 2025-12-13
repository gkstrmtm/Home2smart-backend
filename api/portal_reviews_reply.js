import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    const reviewId = body?.review_id;
    const message = body?.message?.trim();

    const proId = await validateSession(token);

    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    if (!reviewId) {
      return res.status(400).json({
        ok: false,
        error: 'review_id is required',
        error_code: 'missing_review_id'
      });
    }

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: 'Reply message cannot be empty',
        error_code: 'empty_message'
      });
    }

    // Verify the review exists and belongs to this pro
    const { data: review, error: reviewError } = await supabase
      .from('h2s_dispatch_reviews')
      .select('review_id, pro_id')
      .eq('review_id', reviewId)
      .single();

    if (reviewError || !review) {
      return res.status(404).json({
        ok: false,
        error: 'Review not found',
        error_code: 'review_not_found'
      });
    }

    if (review.pro_id !== proId) {
      return res.status(403).json({
        ok: false,
        error: 'You can only reply to your own reviews',
        error_code: 'forbidden'
      });
    }

    // Insert reply
    const { data: reply, error: insertError } = await supabase
      .from('h2s_dispatch_replies')
      .insert([{
        review_id: reviewId,
        author_type: 'pro',
        author_id: proId,
        message: message,
        pro_id: proId,
        who: 'Pro'
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Reply insert error:', insertError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to post reply',
        error_code: 'insert_failed'
      });
    }

    return res.json({
      ok: true,
      reply: reply
    });

  } catch (error) {
    console.error('Reply error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
