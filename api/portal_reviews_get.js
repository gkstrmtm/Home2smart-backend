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
    const proId = await validateSession(token);

    if (!proId) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid/expired session',
        error_code: 'bad_session'
      });
    }

    // Get reviews and replies in parallel
    const [reviewsResult, repliesResult] = await Promise.all([
      supabase
        .from('h2s_dispatch_reviews')
        .select('*')
        .eq('pro_id', proId)
        .order('created_at', { ascending: false }),
      supabase
        .from('h2s_dispatch_replies')
        .select('*')
        .eq('pro_id', proId)
    ]);

    if (reviewsResult.error) {
      console.error('Reviews query error:', reviewsResult.error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to load reviews'
      });
    }

    const reviews = reviewsResult.data || [];
    const replies = repliesResult.data || [];

    // Index replies by review_id
    const replyMap = {};
    replies.forEach(reply => {
      if (!replyMap[reply.review_id]) {
        replyMap[reply.review_id] = [];
      }
      replyMap[reply.review_id].push(reply);
    });

    // Attach replies to reviews
    const reviewsWithReplies = reviews.map(review => ({
      ...review,
      replies: replyMap[review.review_id] || []
    }));

    return res.json({
      ok: true,
      reviews: reviewsWithReplies
    });

  } catch (error) {
    console.error('Reviews error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Server error: ' + error.message,
      error_code: 'server_error'
    });
  }
}
