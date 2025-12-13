// Read-only endpoint: returns AI analyzer scores for given video IDs.
// In a real setup, this would query your DB table where the analyzer persisted results.
// For now, it computes on-the-fly using the same heuristics to unblock the frontend.

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const body = await readJson(req);
    const videos = Array.isArray(body?.videos) ? body.videos : [];
    if (videos.length === 0) {
      return res.status(400).json({ ok: false, error: 'No videos provided' });
    }

    // Compute scores (stub). Replace with DB lookup when available.
    const scores = videos.map(v => {
      const { auto_category, auto_priority_score } = classifyAndScore(v);
      return { id: v.id, auto_category, auto_priority_score };
    });

    return res.status(200).json({ ok: true, scores });
  } catch (err) {
    console.error('[training_scores] Error:', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

function classifyAndScore(video) {
  const title = (video.title || '').toLowerCase();
  const desc = (video.description || '').toLowerCase();
  const text = `${title} ${desc}`;
  const dur = Number(video.duration_sec || 0);

  let cat = 'Optional';
  if (text.includes('getting started') || text.includes('onboarding') || text.includes('setup')) cat = 'Setup';
  if (text.includes('policy') || text.includes('required')) cat = 'Critical';
  if (text.includes('troubleshoot') || text.includes('fix') || text.includes('repair')) cat = 'Troubleshooting';
  if (text.includes('advanced') || text.includes('pro tips')) cat = 'Advanced';

  let score = 0;
  if (cat === 'Critical') score += 8;
  else if (cat === 'Setup') score += 6;
  else if (cat === 'Troubleshooting') score += 5;
  else if (cat === 'Advanced') score += 3;

  if (dur >= 300 && dur <= 900) score += 2;
  else if (dur > 1500) score -= 1;
  else if (dur > 0 && dur < 60) score -= 2;

  if (!video.url) score -= 3;
  if (!video.thumbnail) score -= 1;

  score = Math.max(0, Math.min(10, score));
  return { auto_category: cat, auto_priority_score: score };
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}
