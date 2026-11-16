export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const expected = process.env.MYAGENT_CLIENT_API_KEY || ''
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!expected) return res.status(503).json({ error: { message: 'External API access is not configured.', type: 'api_error' } })
  if (!supplied || supplied !== expected) return res.status(401).json({ error: { message: 'Invalid API key.', type: 'authentication_error' } })

  const pathname = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '')
  if (req.method === 'GET' && pathname.endsWith('/models')) {
    return res.status(200).json({
      object: 'list',
      data: [{ id: process.env.MY_MODEL || 'myrqvia', object: 'model', created: 0, owned_by: 'myagent' }]
    })
  }

  const isChat = req.method === 'POST' && pathname.endsWith('/chat/completions')
  const isCompletion = req.method === 'POST' && !isChat && pathname.endsWith('/completions')
  if (!isChat && !isCompletion) return res.status(404).json({ error: { message: 'Not found.', type: 'invalid_request_error' } })

  const baseUrl = String(process.env.MY_BASE_URL || '').replace(/\/+$/, '')
  const upstreamKey = process.env.MY_API_KEY || ''
  if (!baseUrl || !upstreamKey) return res.status(503).json({ error: { message: 'Hosted model is not configured.', type: 'api_error' } })

  try {
    const body = { ...(req.body || {}), model: String(req.body?.model || process.env.MY_MODEL || 'myrqvia') }
    const upstream = await fetch(baseUrl + (isChat ? '/chat/completions' : '/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + upstreamKey },
      body: JSON.stringify(body)
    })
    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    if (!upstream.body) return res.end()
    const reader = upstream.body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!res.write(Buffer.from(value))) await new Promise<void>(resolve => res.once('drain', resolve))
    }
    return res.end()
  } catch (error) {
    console.error('[MyAgent] OpenAI-compatible proxy failed:', error instanceof Error ? error.message : 'unknown')
    if (!res.headersSent) return res.status(502).json({ error: { message: 'Upstream model is temporarily unavailable.', type: 'api_error' } })
    return res.end()
  }
}
