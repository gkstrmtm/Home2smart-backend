// Returns whether OPENAI_API_KEY is configured in the server environment.
export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    const hasKey = !!process.env.OPENAI_API_KEY;
    return res.status(200).json({ ok: true, hasKey });
  } catch (err) {
    console.error('[check-openai] Error:', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}
