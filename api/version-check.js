export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({
    deployed: true,
    timestamp: new Date().toISOString(),
    commit: '4287ab9',
    fixes: ['stripe_session_id column', 'SERVICE_ROLE_KEY', 'debug object'],
    test: 'VERSION_4287AB9_DEPLOYED'
  });
}
