// Minimal analyzer job: classifies and scores training videos.
// This is designed to run as a serverless function you can trigger manually or via a scheduler.
// It uses simple heuristics when no AI key is present.

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

    const useAI = !!process.env.OPENAI_API_KEY;
    let analyzed;
    if (useAI) {
      analyzed = await analyzeWithOpenAI(videos, process.env.OPENAI_API_KEY);
    } else {
      analyzed = videos.map(v => {
        const { auto_category, auto_priority_score } = classifyAndScore(v);
        return { id: v.id, auto_category, auto_priority_score };
      });
    }

    // TODO: Persist scores to your DB (e.g., Supabase) if desired
    // For now return the computed scores
    return res.status(200).json({ ok: true, analyzed });
  } catch (err) {
    console.error('[training_analyzer] Error:', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

function classifyAndScore(video) {
  const title = (video.title || '').toLowerCase();
  const desc = (video.description || '').toLowerCase();
  const text = `${title} ${desc}`;
  const dur = Number(video.duration_sec || 0);

  // Category heuristics
  let cat = 'Optional';
  if (text.includes('getting started') || text.includes('onboarding') || text.includes('setup')) cat = 'Setup';
  if (text.includes('policy') || text.includes('required')) cat = 'Critical';
  if (text.includes('troubleshoot') || text.includes('fix') || text.includes('repair')) cat = 'Troubleshooting';
  if (text.includes('advanced') || text.includes('pro tips')) cat = 'Advanced';

  // Priority heuristics base
  let score = 0;
  if (cat === 'Critical') score += 8;
  else if (cat === 'Setup') score += 6;
  else if (cat === 'Troubleshooting') score += 5;
  else if (cat === 'Advanced') score += 3;

  // Duration sweet spot: 5–15 min
  if (dur >= 300 && dur <= 900) score += 2;
  else if (dur > 1500) score -= 1;
  else if (dur > 0 && dur < 60) score -= 2;

  // Content quality hints
  if (!video.url) score -= 3;
  if (!video.thumbnail) score -= 1;

  // Clamp 0–10
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

async function analyzeWithOpenAI(videos, apiKey) {
  // Batch prompt: summarize category + score per item
  const items = videos.map(v => ({
    id: v.id,
    title: v.title || '',
    description: v.description || '',
    duration_sec: v.duration_sec || 0,
    tags: v.tags || []
  }));

  const system = "You are a training content classifier. Classify each item with auto_category in {Critical, Setup, Troubleshooting, Advanced, Optional} and provide auto_priority_score 0-10, integer or decimal.";
  const user = {
    type: 'text',
    text: `Classify and score these items. Return JSON array of {id, auto_category, auto_priority_score}.
Items:
${JSON.stringify(items)}`
  };

  const body = {
    model: 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: [{ type: 'text', text: system }] },
      { role: 'user', content: [user] }
    ],
    temperature: 0.2
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error('[training_analyzer] OpenAI error:', resp.status, txt);
    // Fallback to heuristics
    return videos.map(v => {
      const { auto_category, auto_priority_score } = classifyAndScore(v);
      return { id: v.id, auto_category, auto_priority_score };
    });
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : videos.map(v => ({ id: v.id, ...classifyAndScore(v) }));
  } catch {
    // If model replied in text, try a loose parse; else fallback
    return videos.map(v => {
      const { auto_category, auto_priority_score } = classifyAndScore(v);
      return { id: v.id, auto_category, auto_priority_score };
    });
  }
}
