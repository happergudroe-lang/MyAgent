import express from 'express'
import type { Pool } from 'pg'
import { createDecipheriv, createCipheriv, createHash, randomBytes } from 'node:crypto'

type Queryable = Pick<Pool, 'query'>
type WeComMessage = { toUser: string; fromUser: string; chatId: string; createTime: string; msgType: string; content: string; agentName: string; msgId: string }

const env = () => ({
  corpId: process.env.WECOM_CORP_ID || '',
  agentId: process.env.WECOM_AGENT_ID || '',
  token: process.env.WECOM_TOKEN || '',
  aesKey: process.env.WECOM_AES_KEY || ''
})
const sha1 = (...parts: string[]) => createHash('sha1').update(parts.sort().join('')).digest('hex')
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const xmlValue = (xml: string, tag: string) => {
  const match = xml.match(new RegExp('<' + tag + '>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</' + tag + '>'))
  return (match?.[1] ?? match?.[2] ?? '').trim()
}
const unpad = (data: Buffer) => {
  const n = data[data.length - 1]
  if (n < 1 || n > 32 || !data.subarray(data.length - n).every(x => x === n)) throw new Error('Invalid WeCom PKCS7 padding')
  return data.subarray(0, data.length - n)
}
function aesKey() {
  const key = Buffer.from(env().aesKey + '=', 'base64')
  if (key.length !== 32) throw new Error('WECOM_AES_KEY must be the 43-character EncodingAESKey from WeCom')
  return key
}
function decrypt(encrypted: string) {
  const key = aesKey()
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16))
  decipher.setAutoPadding(false)
  const plain = unpad(Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]))
  const length = plain.readUInt32BE(16)
  const corpId = plain.subarray(20 + length).toString()
  if (corpId !== env().corpId) throw new Error('WeCom CorpID mismatch')
  return plain.subarray(20, 20 + length).toString()
}
function encrypt(message: string) {
  const key = aesKey()
  const body = Buffer.from(message)
  const length = Buffer.alloc(4); length.writeUInt32BE(body.length)
  const payload = Buffer.concat([randomBytes(16), length, body, Buffer.from(env().corpId)])
  const pad = 32 - payload.length % 32
  const padded = Buffer.concat([payload, Buffer.alloc(pad, pad)])
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
}
function verify(signature: string, timestamp: string, nonce: string, encrypted = '') {
  const { token } = env()
  const expected = sha1(token, timestamp, nonce, encrypted)
  if (!signature || expected !== signature) throw new Error('Invalid WeCom callback signature')
}
function unwrap(xml: string, timestamp: string, nonce: string, signature: string) {
  const encrypted = xmlValue(xml, 'Encrypt')
  if (!encrypted) { verify(signature, timestamp, nonce); return xml }
  verify(signature, timestamp, nonce, encrypted)
  return decrypt(encrypted)
}
function wrapReply(reply: string, timestamp: string, nonce: string) {
  if (!env().aesKey) return reply
  const encrypted = encrypt(reply)
  const signature = sha1(env().token, timestamp, nonce, encrypted)
  return '<xml><Encrypt><![CDATA[' + encrypted + ']]></Encrypt><MsgSignature><![CDATA[' + signature + ']]></MsgSignature><TimeStamp>' + timestamp + '</TimeStamp><Nonce><![CDATA[' + nonce + ']]></Nonce></xml>'
}
function parseMessage(xml: string): WeComMessage | null {
  const msgType = xmlValue(xml, 'MsgType').toLowerCase()
  if (msgType !== 'text') return null
  const content = xmlValue(xml, 'Content')
  const mention = content.match(/^\s*@([^\s,，:：]+)\s*([\s\S]*)$/)
  const command = content.match(/^\s*\/agent(?:\s+([\s\S]*))?$/i)
  if (!mention && !command) return null
  const commandBody = (command?.[1] || '').trim()
  const commandParts = commandBody.match(/^([^\s]+)\s+([\s\S]*)$/)
  const commandHasAgent = Boolean(commandParts && (aliases[commandParts[1].toLowerCase()] || aliases[commandParts[1]]))
  return {
    toUser: xmlValue(xml, 'ToUserName'), fromUser: xmlValue(xml, 'FromUserName'), chatId: xmlValue(xml, 'ChatId') || xmlValue(xml, 'FromUserName'),
    createTime: xmlValue(xml, 'CreateTime'), msgType, content: (mention?.[2] ?? (commandHasAgent ? commandParts![2] : commandBody)).trim(),
    agentName: mention?.[1] ?? (commandHasAgent ? commandParts![1] : ''), msgId: xmlValue(xml, 'MsgId')
  }
}
const aliases: Record<string, { provider: string; model?: string }> = {
  claude: { provider: 'claude' }, gpt: { provider: 'openai' }, openai: { provider: 'openai' },
  gemini: { provider: 'gemini' }, deepseek: { provider: 'deepseek' }, '本机': { provider: 'my' }, my: { provider: 'my' }
}
function providerConfig(provider: string) {
  const configs: Record<string, { key: string; base: string; model: string; anthropic?: boolean }> = {
    openai: { key: 'OPENAI_API_KEY', base: 'https://api.openai.com/v1', model: process.env.WECOM_GPT_MODEL || 'gpt-4o-mini' },
    claude: { key: 'ANTHROPIC_API_KEY', base: 'https://api.anthropic.com', model: process.env.WECOM_CLAUDE_MODEL || 'claude-sonnet-4-5', anthropic: true },
    gemini: { key: 'GEMINI_API_KEY', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: process.env.WECOM_GEMINI_MODEL || 'gemini-2.5-flash' },
    deepseek: { key: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com', model: process.env.WECOM_DEEPSEEK_MODEL || 'deepseek-chat' },
    my: { key: 'MY_API_KEY', base: process.env.MY_BASE_URL || '', model: process.env.MY_MODEL || 'myrqvia' }
  }
  return configs[provider] || configs[process.env.WECOM_DEFAULT_PROVIDER || 'my']
}
async function generate(provider: string, prompt: string) {
  const cfg = providerConfig(provider)
  const apiKey = process.env[cfg.key]
  if (!apiKey || !cfg.base) return '这个 Agent 的模型服务尚未配置。请管理员配置 ' + cfg.key + '。'
  const system = '你是 MyAgent 企业微信助手。用中文简洁回答，优先给出可执行结果。当前日期：' + new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) + '。不要声称执行了未实际执行的操作。'
  const response = cfg.anthropic
    ? await fetch(cfg.base + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: cfg.model, max_tokens: 1800, system, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(4200) })
    : await fetch(cfg.base.replace(/\\/$/, '') + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey }, body: JSON.stringify({ model: cfg.model, temperature: 0.4, max_tokens: 1800, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }), signal: AbortSignal.timeout(4200) })
  if (!response.ok) throw new Error('Provider request failed: ' + response.status)
  const data: any = await response.json()
  const text = cfg.anthropic ? (data.content || []).filter((x: any) => x.type === 'text').map((x: any) => x.text).join('') : data.choices?.[0]?.message?.content
  return String(text || '模型没有返回文本。').slice(0, 3800)
}
function textReply(to: string, from: string, content: string) {
  return '<xml><ToUserName><![CDATA[' + to + ']]></ToUserName><FromUserName><![CDATA[' + from + ']]></FromUserName><CreateTime>' + Math.floor(Date.now() / 1000) + '</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[' + content.replace(/]]>/g, ']]]]><![CDATA[>') + ']]></Content></xml>'
}
async function ensureSchema(db: Queryable) {
  await db.query(`CREATE TABLE IF NOT EXISTS public.wecom_sessions (
    chat_id text NOT NULL, user_id text NOT NULL, session_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(chat_id,user_id))`)
  await db.query(`CREATE TABLE IF NOT EXISTS public.wecom_audit_logs (
    id bigserial PRIMARY KEY, msg_id text UNIQUE, chat_id text NOT NULL, user_id text NOT NULL,
    agent_name text NOT NULL, provider text NOT NULL, prompt text NOT NULL DEFAULT '',
    response text NOT NULL DEFAULT '', status text NOT NULL, duration_ms integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now())`)
  await db.query(`CREATE TABLE IF NOT EXISTS public.wecom_approvals (
    id uuid PRIMARY KEY, chat_id text NOT NULL, user_id text NOT NULL, action text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz)`)
}

export function mountWecomGateway(app: express.Express, db: Queryable) {
  const router = express.Router()
  router.get('/callback', async (req, res) => {
    try {
      const { token, corpId } = env()
      if (!token || !corpId) return res.status(503).send('WeCom is not configured')
      const timestamp = String(req.query.timestamp || ''), nonce = String(req.query.nonce || '')
      const encryptedEcho = String(req.query.echostr || '')
      verify(String(req.query.msg_signature || req.query.signature || ''), timestamp, nonce, encryptedEcho)
      res.type('text/plain').send(env().aesKey ? decrypt(encryptedEcho) : encryptedEcho)
    } catch { res.status(403).send('invalid signature or encrypted echo') }
  })
  router.post('/callback', express.text({ type: ['text/xml', 'application/xml', '*/xml'], limit: '1mb' }), async (req, res) => {
    const started = Date.now()
    try {
      const { token, corpId } = env()
      if (!token || !corpId) return res.status(503).send('WeCom is not configured')
      const timestamp = String(req.query.timestamp || ''), nonce = String(req.query.nonce || '')
      const xml = unwrap(String(req.body || ''), timestamp, nonce, String(req.query.msg_signature || req.query.signature || ''))
      const msg = parseMessage(xml)
      if (!msg) return res.status(200).send('success')
      await ensureSchema(db)
      if (msg.msgId) {
        const duplicate = await db.query('SELECT 1 FROM public.wecom_audit_logs WHERE msg_id=$1', [msg.msgId])
        if (duplicate.rowCount) return res.status(200).send('success')
      }
      const command = msg.content.trim()
      const approval = command.match(/^(批准|拒绝)\\s+([0-9a-f-]{36})$/i)
      if (approval) {
        const status = approval[1] === '批准' ? 'approved' : 'rejected'
        const updated = await db.query(`UPDATE public.wecom_approvals SET status=$1,decided_at=now()
          WHERE id=$2 AND chat_id=$3 AND user_id=$4 AND status='pending' RETURNING id`, [status, approval[2], msg.chatId, msg.fromUser])
        const reply = updated.rowCount ? (status === 'approved' ? '已批准。该操作已进入执行队列；当前网关版本尚未开放外部副作用工具。' : '已拒绝，操作不会执行。') : '没有找到属于当前会话的待审批操作。'
        const body = textReply(msg.fromUser, msg.toUser, reply)
        return res.type('application/xml').send(wrapReply(body, timestamp, nonce))
      }
      const route = aliases[msg.agentName.toLowerCase()] || aliases[msg.agentName]
      const provider = route?.provider || process.env.WECOM_DEFAULT_PROVIDER || 'my'
      const dangerous = /发(送)?(消息|文件)|删除|写入文件|执行命令|转账|付款|邀请成员/.test(command)
      if (dangerous) {
        const id = randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
        await db.query('INSERT INTO public.wecom_approvals(id,chat_id,user_id,action,payload) VALUES($1,$2,$3,$4,$5)', [id, msg.chatId, msg.fromUser, 'manual_review', JSON.stringify({ command, agent: msg.agentName })])
        const reply = '这项操作需要人工确认，尚未执行。审批编号：' + id + '\\n请回复：批准 ' + id + ' 或 拒绝 ' + id
        const body = textReply(msg.fromUser, msg.toUser, reply)
        return res.type('application/xml').send(wrapReply(body, timestamp, nonce))
      }
      const existing = await db.query('SELECT session_id FROM public.wecom_sessions WHERE chat_id=$1 AND user_id=$2', [msg.chatId, msg.fromUser])
      const sessionId = existing.rows[0]?.session_id || randomBytes(16).toString('hex')
      await db.query(`INSERT INTO public.wecom_sessions(chat_id,user_id,session_id) VALUES($1,$2,$3)
        ON CONFLICT(chat_id,user_id) DO UPDATE SET updated_at=now()`, [msg.chatId, msg.fromUser, sessionId])
      const prompt = command || '请介绍你能完成的工作。'
      let answer = ''
      let status = 'ok'
      try {
        if (/今天几号|今天日期|现在日期/.test(prompt)) answer = '今天是 ' + new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeZone: 'Asia/Shanghai' }).format(new Date()) + '（Asia/Shanghai）。'
        else answer = await generate(provider, prompt)
      } catch (error) { status = 'error'; answer = '模型暂时不可用：' + (error instanceof Error ? error.message : 'unknown error') }
      const duration = Date.now() - started
      await db.query(`INSERT INTO public.wecom_audit_logs(msg_id,chat_id,user_id,agent_name,provider,prompt,response,status,duration_ms)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(msg_id) DO NOTHING`,
        [msg.msgId || null, msg.chatId, msg.fromUser, msg.agentName, provider, prompt.slice(0, 4000), answer.slice(0, 4000), status, duration])
      const body = textReply(msg.fromUser, msg.toUser, answer)
      res.type('application/xml').send(wrapReply(body, timestamp, nonce))
    } catch (error) {
      console.error('[WeCom] callback failed:', error instanceof Error ? error.message : 'unknown error')
      res.status(200).send('success')
    }
  })
  app.use('/wecom', router)
  app.get('/api/wecom/status', async (_req, res) => {
    try {
      await ensureSchema(db)
      const { corpId, agentId, token, aesKey } = env()
      const count = await db.query('SELECT count(*)::int AS count FROM public.wecom_sessions')
      res.json({ configured: Boolean(corpId && agentId && token && aesKey), callbackUrl: '/wecom/callback', encryptedMode: Boolean(aesKey), bindings: count.rows[0]?.count || 0 })
    } catch { res.status(503).json({ configured: false, error: 'WeCom database schema unavailable' }) }
  })
}
