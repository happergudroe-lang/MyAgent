import 'dotenv/config'
import express from 'express'
import { evaluate } from 'mathjs'

const app = express()
const port = Number(process.env.PORT || 3001)
app.use(express.json({ limit: '100kb' }))

type ProviderId = 'openai' | 'deepseek' | 'claude' | 'gemini' | 'qwen' | 'custom'
type ChatMessage = { role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }
const providers: Record<ProviderId, { label: string; envKey: string; baseUrl: string; protocol: 'openai' | 'anthropic'; models: string[] }> = {
  openai: { label: 'OpenAI', envKey: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1', protocol: 'openai', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
  deepseek: { label: 'DeepSeek', envKey: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com', protocol: 'openai', models: ['deepseek-chat', 'deepseek-reasoner'] },
  claude: { label: 'Claude', envKey: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest'] },
  gemini: { label: 'Gemini', envKey: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
  qwen: { label: 'Qwen', envKey: 'QWEN_API_KEY', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  custom: { label: '自定义服务商', envKey: 'CUSTOM_API_KEY', baseUrl: process.env.CUSTOM_BASE_URL || '', protocol: 'openai', models: (process.env.CUSTOM_MODELS || 'your-model').split(',').map(x => x.trim()).filter(Boolean) }
}
const toolSpecs = [
  { type: 'function', function: { name: 'calculator', description: '计算数学表达式。只用于纯数学计算，不执行代码。', parameters: { type: 'object', properties: { expression: { type: 'string', description: '数学表达式，例如 (128*36)/4' } }, required: ['expression'], additionalProperties: false } } },
  { type: 'function', function: { name: 'get_current_time', description: '获取服务器当前日期、时间和时区。', parameters: { type: 'object', properties: { timezone: { type: 'string', description: 'IANA 时区，例如 Asia/Shanghai 或 America/Los_Angeles' } }, additionalProperties: false } } }
]
function sendEvent(res: express.Response, data: object | '[DONE]') {
  res.write('data: ' + (data === '[DONE]' ? '[DONE]' : JSON.stringify(data)) + '\n\n')
}
function runTool(name: string, rawArgs: string) {
  let args: any
  try { args = JSON.parse(rawArgs || '{}') } catch { return { ok: false, error: '工具参数不是有效 JSON。' } }
  if (name === 'calculator') {
    const expression = String(args.expression || '')
    if (!expression || expression.length > 160 || !/^[0-9+\-*/().,%\s^]+$/.test(expression)) return { ok: false, error: '只允许数字和基本数学运算符。' }
    try {
      const result = evaluate(expression, {}, { predictable: true } as any)
      if (typeof result !== 'number' || !Number.isFinite(result)) return { ok: false, error: '表达式结果不是有限数字。' }
      return { ok: true, result }
    } catch { return { ok: false, error: '无法计算该表达式。' } }
  }
  if (name === 'get_current_time') {
    const timezone = typeof args.timezone === 'string' ? args.timezone : 'UTC'
    try {
      const now = new Date()
      return { ok: true, iso: now.toISOString(), local: new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeStyle: 'long', timeZone: timezone }).format(now), timezone }
    } catch { return { ok: false, error: '无效的时区名称。' } }
  }
  return { ok: false, error: '该工具不存在或未开放。' }
}
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, configuredProviders: Object.values(providers).filter(p => Boolean(process.env[p.envKey])).length, tools: ['calculator', 'get_current_time'] })
})
app.get('/api/providers', (_req, res) => {
  res.json({ providers: Object.entries(providers).map(([id, p]) => ({ id, label: p.label, configured: Boolean(process.env[p.envKey]), models: p.models })) })
})
app.get('/api/tools', (_req, res) => {
  res.json({ tools: [{ id: 'calculator', name: '计算器', description: '安全数学表达式计算', enabled: true }, { id: 'get_current_time', name: '当前时间', description: '获取指定时区的当前时间', enabled: true }] })
})
app.post('/api/chat', async (req, res) => {
  const { messages, model, provider: requestedProvider, enabledTools = [] } = req.body ?? {}
  const providerId = (requestedProvider || 'openai') as ProviderId
  const config = providers[providerId]
  if (!config) return res.status(400).json({ error: '不支持的模型服务商。' })
  const apiKey = process.env[config.envKey]
  if (!apiKey) return res.status(503).json({ error: config.label + ' 尚未配置 API Key，请在服务端 .env 中填写 ' + config.envKey + '。' })
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) return res.status(400).json({ error: 'messages 必须是 1 到 40 条消息的数组。' })
  const safeMessages: ChatMessage[] = []
  for (const m of messages) {
    if (!['user', 'assistant', 'system'].includes(m?.role) || typeof m?.content !== 'string') return res.status(400).json({ error: '消息格式无效。' })
    safeMessages.push({ role: m.role, content: m.content.slice(0, 12000) })
  }
  const selectedModel = String(model || config.models[0])
  if (!config.models.includes(selectedModel) && providerId !== 'custom') return res.status(400).json({ error: '所选模型不属于当前服务商。' })
  const baseUrl = config.baseUrl.replace(/\/$/, '')
  if (!baseUrl) return res.status(400).json({ error: '请先设置 CUSTOM_BASE_URL。' })
  const isClaude = config.protocol === 'anthropic'
  const systemText = safeMessages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  const chatMessages = safeMessages.filter(m => m.role !== 'system')
  const allowedTools = Array.isArray(enabledTools) ? enabledTools.filter((x: string) => ['calculator', 'get_current_time'].includes(x)) : []
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isClaude) { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01' }
  else headers.Authorization = 'Bearer ' + apiKey
  const executeOpenAI = async (history: ChatMessage[]) => {
    const response = await fetch(baseUrl + '/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model: selectedModel, messages: history, ...(allowedTools.length ? { tools: toolSpecs.filter((t: any) => allowedTools.includes(t.function.name)), tool_choice: 'auto' } : {}) }) })
    if (!response.ok) throw new Error((await response.text()).slice(0, 1000) || '模型请求失败')
    return response.json()
  }
  const executeClaude = async (history: ChatMessage[]) => {
    const claudeTools = [
      { name: 'calculator', description: '计算数学表达式，不执行代码。', input_schema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } },
      { name: 'get_current_time', description: '获取服务器当前时间。', input_schema: { type: 'object', properties: { timezone: { type: 'string' } } } }
    ].filter(t => allowedTools.includes(t.name))
    const response = await fetch(baseUrl + '/v1/messages', { method: 'POST', headers, body: JSON.stringify({ model: selectedModel, max_tokens: 4096, stream: false, ...(systemText ? { system: systemText } : {}), messages: history.filter(m => m.role !== 'system'), ...(claudeTools.length ? { tools: claudeTools } : {}) }) })
    if (!response.ok) throw new Error((await response.text()).slice(0, 1000) || 'Claude 请求失败')
    return response.json()
  }
  try {
    let answer = ''
    if (isClaude) {
      let history: ChatMessage[] = chatMessages
      for (let step = 0; step < 5; step++) {
        const result = await executeClaude(history)
        const blocks = result.content || []
        const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        const calls = blocks.filter((b: any) => b.type === 'tool_use')
        if (!calls.length) { answer = text; break }
        history = [...history, { role: 'assistant', content: text || '[tool call]' } as ChatMessage]
        const toolResults = []
        for (const call of calls) {
          sendEvent(res, { tool: { name: call.name, status: 'running', input: call.input } })
          const output = runTool(call.name, JSON.stringify(call.input))
          sendEvent(res, { tool: { name: call.name, status: 'completed', output } })
          toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output) })
        }
        history.push({ role: 'user', content: JSON.stringify(toolResults) })
      }
    } else {
      let history = [...safeMessages]
      for (let step = 0; step < 5; step++) {
        const result = await executeOpenAI(history)
        const choice = result.choices?.[0]?.message
        if (!choice) throw new Error('模型没有返回有效消息。')
        const calls = choice.tool_calls || []
        if (!calls.length) { answer = choice.content || ''; break }
        history.push({ role: 'assistant', content: choice.content || '', tool_calls: calls })
        for (const call of calls) {
          const name = call.function?.name || ''
          const args = call.function?.arguments || '{}'
          sendEvent(res, { tool: { name, status: 'running', input: args } })
          const output = runTool(name, args)
          sendEvent(res, { tool: { name, status: 'completed', output } })
          history.push({ role: 'tool', tool_call_id: call.id, name, content: JSON.stringify(output) })
        }
      }
    }
    if (answer) sendEvent(res, { text: answer })
    else sendEvent(res, { error: 'Agent 工具调用达到最大轮数，或模型没有生成最终答复。' })
    sendEvent(res, '[DONE]')
  } catch (error) {
    sendEvent(res, { error: error instanceof Error ? error.message : '模型请求失败。' })
  } finally { res.end() }
})
app.listen(port, '127.0.0.1', () => console.log('MyAgent API server listening on http://127.0.0.1:' + port))
