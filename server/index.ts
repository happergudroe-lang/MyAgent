import 'dotenv/config'
import express from 'express'

const app = express()
const port = Number(process.env.PORT || 3001)
app.use(express.json({ limit: '100kb' }))

type ProviderId = 'openai' | 'deepseek' | 'claude' | 'gemini' | 'qwen' | 'custom'
const providers: Record<ProviderId, { label: string; envKey: string; baseUrl: string; protocol: 'openai' | 'anthropic'; models: string[] }> = {
  openai: { label: 'OpenAI', envKey: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1', protocol: 'openai', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
  deepseek: { label: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com', protocol: 'openai', models: ['deepseek-chat', 'deepseek-reasoner'] },
  claude: { label: 'Claude', envKey: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest'] },
  gemini: { label: 'Gemini', envKey: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
  qwen: { label: 'Qwen', envKey: 'QWEN_API_KEY', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  custom: { label: '自定义服务商', envKey: 'CUSTOM_API_KEY', baseUrl: process.env.CUSTOM_BASE_URL || '', protocol: 'openai', models: (process.env.CUSTOM_MODELS || 'your-model').split(',').map(x => x.trim()).filter(Boolean) }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configuredProviders: Object.values(providers).filter(p => Boolean(process.env[p.envKey])).length })
})

app.get('/api/providers', (_req, res) => {
  res.json({ providers: Object.entries(providers).map(([id, p]) => ({
    id, label: p.label, configured: Boolean(process.env[p.envKey]), models: p.models
  })) })
})

function sendEvent(res: express.Response, data: object | '[DONE]') {
  res.write('data: ' + (data === '[DONE]' ? '[DONE]' : JSON.stringify(data)) + '\n\n')
}

app.post('/api/chat', async (req, res) => {
  const { messages, model, provider: requestedProvider } = req.body ?? {}
  const providerId = (requestedProvider || 'openai') as ProviderId
  const config = providers[providerId]
  if (!config) return res.status(400).json({ error: '不支持的模型服务商。' })
  const apiKey = process.env[config.envKey]
  if (!apiKey) return res.status(503).json({ error: config.label + ' 尚未配置 API Key，请在服务端 .env 中填写 ' + config.envKey + '。' })
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
    return res.status(400).json({ error: 'messages 必须是 1 到 40 条消息的数组。' })
  }
  const safeMessages: { role: string; content: string }[] = []
  for (const m of messages) {
    if (!['user', 'assistant', 'system'].includes(m?.role) || typeof m?.content !== 'string') {
      return res.status(400).json({ error: '消息格式无效。' })
    }
    safeMessages.push({ role: m.role, content: m.content.slice(0, 12000) })
  }
  const selectedModel = String(model || config.models[0])
  if (!config.models.includes(selectedModel) && providerId !== 'custom') {
    return res.status(400).json({ error: '所选模型不属于当前服务商。' })
  }

  const isClaude = config.protocol === 'anthropic'
  const baseUrl = providerId === 'custom' ? config.baseUrl : config.baseUrl
  if (!baseUrl) return res.status(400).json({ error: '请先设置 CUSTOM_BASE_URL。' })

  const systemText = safeMessages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  const chatMessages = safeMessages.filter(m => m.role !== 'system')
  const url = isClaude ? baseUrl.replace(/\/$/, '') + '/v1/messages' : baseUrl.replace(/\/$/, '') + '/chat/completions'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: object
  if (isClaude) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    body = { model: selectedModel, max_tokens: 4096, stream: true, ...(systemText ? { system: systemText } : {}), messages: chatMessages }
  } else {
    headers.Authorization = 'Bearer ' + apiKey
    body = { model: selectedModel, messages: safeMessages, stream: true }
  }

  const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }).catch(() => null)
  if (!upstream) return res.status(502).json({ error: '无法连接 ' + config.label + '，请检查服务地址和网络。' })
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '')
    return res.status(upstream.status || 502).json({ error: detail.slice(0, 1200) || config.label + ' 请求失败。' })
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
      const events = buffer.split('\n\n')
      buffer = events.pop() || ''
      for (const eventBlock of events) {
        const lines = eventBlock.split('\n')
        let eventName = ''
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          try {
            const event = JSON.parse(payload)
            let delta: unknown
            if (isClaude) {
              if (event.type === 'content_block_delta') delta = event.delta?.text
              if (event.type === 'error') throw new Error(event.error?.message || 'Claude stream error')
            } else {
              delta = event.choices?.[0]?.delta?.content
            }
            if (typeof delta === 'string' && delta) sendEvent(res, { text: delta })
          } catch (error) {
            if (eventName === 'error') throw error
          }
        }
      }
    }
    sendEvent(res, '[DONE]')
  } catch (error) {
    sendEvent(res, { error: error instanceof Error ? error.message : '模型连接中断。' })
  } finally {
    reader.releaseLock()
    res.end()
  }
})

app.listen(port, '127.0.0.1', () => {
  console.log('MyAgent API server listening on http://127.0.0.1:' + port)
})
