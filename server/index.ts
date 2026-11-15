import 'dotenv/config'
import express from 'express'

const app = express()
const port = Number(process.env.PORT || 3001)
app.use(express.json({ limit: '100kb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    providerConfigured: Boolean(process.env.AI_API_KEY),
    model: process.env.AI_MODEL || 'gpt-4o-mini'
  })
})

app.post('/api/chat', async (req, res) => {
  const { messages, model } = req.body ?? {}
  if (!process.env.AI_API_KEY) {
    return res.status(503).json({ error: '尚未配置 AI_API_KEY。请复制 .env.example 为 .env 并填写服务商密钥。' })
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
    return res.status(400).json({ error: 'messages 必须是 1 到 40 条消息的数组。' })
  }
  const safeMessages = messages.map((m: { role?: string; content?: string }) => {
    if (!['user', 'assistant', 'system'].includes(m.role || '') || typeof m.content !== 'string') {
      throw new Error('消息格式无效。')
    }
    return { role: m.role, content: m.content.slice(0, 12000) }
  })
  const base = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  const upstream = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.AI_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: String(model || process.env.AI_MODEL || 'gpt-4o-mini'),
      messages: safeMessages,
      stream: true
    })
  }).catch(() => null)

  if (!upstream) return res.status(502).json({ error: '无法连接模型服务，请检查 AI_BASE_URL 和网络。' })
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    return res.status(upstream.status || 502).json({ error: detail.slice(0, 1200) || '模型服务请求失败。' })
  }

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const event = JSON.parse(payload)
          const delta = event.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta) res.write('data: ' + JSON.stringify({ text: delta }) + '\n\n')
        } catch { /* Ignore non-JSON provider events. */ }
      }
    }
    res.write('data: [DONE]\n\n')
  } catch {
    if (!res.writableEnded) res.write('data: ' + JSON.stringify({ error: '模型连接中断。' }) + '\n\n')
  } finally {
    reader.releaseLock()
    res.end()
  }
})

app.listen(port, '127.0.0.1', () => {
  console.log('MyAgent API server listening on http://127.0.0.1:' + port)
})
