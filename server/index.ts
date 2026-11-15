import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import pdfParse from 'pdf-parse'
import { evaluate } from 'mathjs'
import { randomUUID, createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'

const app = express()
app.use(express.json({ limit: '100kb' }))
const db = new Database(process.env.DATABASE_PATH || './myagent.sqlite')
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
 CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, username TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS conversations (id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,id));
 CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
 CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
`)
const hashToken=(token:string)=>createHash('sha256').update(token).digest('hex')
const COOKIE='myagent_session'
function readCookie(req:express.Request,name:string){const raw=req.headers.cookie||'';for(const part of raw.split(';')){const [key,...value]=part.trim().split('=');if(key===name)return decodeURIComponent(value.join('='))}return ''}
function setSessionCookie(res:express.Response,token:string){res.setHeader('Set-Cookie',COOKIE+'='+encodeURIComponent(token)+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800'+(process.env.NODE_ENV==='production'?'; Secure':''))}
function clearSessionCookie(res:express.Response){res.setHeader('Set-Cookie',COOKIE+'=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'+(process.env.NODE_ENV==='production'?'; Secure':''))}
type AuthRequest=express.Request & {user?:{id:string,email:string,username:string}}
function requireAuth(req:AuthRequest,res:express.Response,next:express.NextFunction){
 const token=readCookie(req,COOKIE)
 if(!token)return res.status(401).json({error:'请先登录。'})
 const session=db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash=?').get(hashToken(token)) as {user_id:string,expires_at:number}|undefined
 if(!session||session.expires_at<Date.now()){if(session)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));clearSessionCookie(res);return res.status(401).json({error:'登录已过期，请重新登录。'})}
 const user=db.prepare('SELECT id,email,username FROM users WHERE id=?').get(session.user_id) as {id:string,email:string,username:string}|undefined
 if(!user){clearSessionCookie(res);return res.status(401).json({error:'账号不存在，请重新登录。'})}
 req.user=user;next()
}
app.post('/api/auth/register',async(req,res)=>{
 const email=String(req.body?.email||'').trim().toLowerCase()
 const username=String(req.body?.username||'').trim()
 const password=String(req.body?.password||'')
 if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)||email.length>254)return res.status(400).json({error:'请输入有效的邮箱地址。'})
 if(username.length<2||username.length>32)return res.status(400).json({error:'用户名需要为 2–32 个字符。'})
 if(password.length<10||password.length>128)return res.status(400).json({error:'密码长度需要为 10–128 位。'})
 if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return res.status(409).json({error:'该邮箱已注册，请直接登录。'})
 const id=randomUUID(), passwordHash=await bcrypt.hash(password,12)
 db.prepare('INSERT INTO users(id,email,username,password_hash,created_at) VALUES(?,?,?,?,?)').run(id,email,username,passwordHash,new Date().toISOString())
 const token=randomUUID()+randomUUID()
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hashToken(token),id,Date.now()+7*86400000,new Date().toISOString())
 setSessionCookie(res,token);res.status(201).json({user:{id,email,username}})
})
app.post('/api/auth/login',async(req,res)=>{
 const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'')
 const user=db.prepare('SELECT id,email,username,password_hash FROM users WHERE email=?').get(email) as any
 if(!user||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({error:'邮箱或密码不正确。'})
 const token=randomUUID()+randomUUID()
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hashToken(token),user.id,Date.now()+7*86400000,new Date().toISOString())
 setSessionCookie(res,token);res.json({user:{id:user.id,email:user.email,username:user.username}})
})
app.get('/api/auth/me',requireAuth,(req:AuthRequest,res)=>res.json({user:req.user}))
app.post('/api/auth/logout',requireAuth,(req:AuthRequest,res)=>{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(readCookie(req,COOKIE)));clearSessionCookie(res);res.json({ok:true})})

const port = Number(process.env.PORT || 3001))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } })
type ProviderId = 'openai' | 'deepseek' | 'claude' | 'gemini' | 'qwen' | 'custom'
type ChatMessage = { role: string; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string }
const providers: Record<ProviderId, { label: string; envKey: string; baseUrl: string; protocol: 'openai' | 'anthropic'; models: string[] }> = {
 openai:{label:'OpenAI',envKey:'OPENAI_API_KEY',baseUrl:'https://api.openai.com/v1',protocol:'openai',models:['gpt-4o','gpt-4o-mini','o3-mini']},
 deepseek:{label:'DeepSeek',envKey:'DEEPSEEK_API_KEY',baseUrl:'https://api.deepseek.com',protocol:'openai',models:['deepseek-chat','deepseek-reasoner']},
 claude:{label:'Claude',envKey:'ANTHROPIC_API_KEY',baseUrl:'https://api.anthropic.com',protocol:'anthropic',models:['claude-sonnet-4-5','claude-opus-4-1','claude-3-5-haiku-latest']},
 gemini:{label:'Gemini',envKey:'GEMINI_API_KEY',baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai',protocol:'openai',models:['gemini-2.5-pro','gemini-2.5-flash','gemini-2.0-flash']},
 qwen:{label:'Qwen',envKey:'QWEN_API_KEY',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',protocol:'openai',models:['qwen-plus','qwen-max','qwen-turbo']},
 custom:{label:'自定义服务商',envKey:'CUSTOM_API_KEY',baseUrl:process.env.CUSTOM_BASE_URL||'',protocol:'openai',models:(process.env.CUSTOM_MODELS||'your-model').split(',').map(x=>x.trim()).filter(Boolean)}
}
const toolSpecs:any[]=[
 {type:'function',function:{name:'calculator',description:'计算数学表达式，不执行代码。',parameters:{type:'object',properties:{expression:{type:'string'}},required:['expression'],additionalProperties:false}}},
 {type:'function',function:{name:'get_current_time',description:'获取指定 IANA 时区的当前日期时间。',parameters:{type:'object',properties:{timezone:{type:'string'}},additionalProperties:false}}},
 {type:'function',function:{name:'web_search',description:'使用联网搜索查询最新网页资料。',parameters:{type:'object',properties:{query:{type:'string',description:'搜索问题'}},required:['query'],additionalProperties:false}}},
 {type:'function',function:{name:'run_code',description:'在隔离的远程 Piston 沙箱中运行 JavaScript 或 Python。执行前必须请求用户批准。',parameters:{type:'object',properties:{language:{type:'string',enum:['javascript','python']},code:{type:'string'}},required:['language','code'],additionalProperties:false}}}
]
const pendingApprovals=new Map<string,(approved:boolean)=>void>()
function sendEvent(res:express.Response,data:object|'[DONE]'){res.write('data: '+(data==='[DONE]'?'[DONE]':JSON.stringify(data))+'\n\n')}
async function executeTool(name:string,rawArgs:string,res:express.Response){
 let args:any
 try{args=JSON.parse(rawArgs||'{}')}catch{return {ok:false,error:'工具参数不是有效 JSON。'}}
 if(name==='calculator'){
  const expression=String(args.expression||'')
  if(!expression||expression.length>160||!/^[0-9+\-*/().,%\s^]+$/.test(expression))return {ok:false,error:'只允许数字和基本数学运算符。'}
  try{const result=evaluate(expression);if(typeof result!=='number'||!Number.isFinite(result))return {ok:false,error:'结果不是有限数字。'};return {ok:true,result}}catch{return {ok:false,error:'无法计算该表达式。'}}
 }
 if(name==='get_current_time'){
  const timezone=typeof args.timezone==='string'?args.timezone:'UTC'
  try{const now=new Date();return {ok:true,iso:now.toISOString(),local:new Intl.DateTimeFormat('zh-CN',{dateStyle:'full',timeStyle:'long',timeZone:timezone}).format(now),timezone}}catch{return {ok:false,error:'无效时区名称。'}}
 }
 if(name==='web_search'){
  if(!process.env.TAVILY_API_KEY)return {ok:false,error:'联网搜索尚未配置。请在服务端 .env 设置 TAVILY_API_KEY。'}
  const query=String(args.query||'').slice(0,400)
  if(!query)return {ok:false,error:'搜索内容不能为空。'}
  const response=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:process.env.TAVILY_API_KEY,query,max_results:5,search_depth:'basic',include_answer:true})})
  if(!response.ok)return {ok:false,error:'搜索服务请求失败：'+response.status}
  const data:any=await response.json()
  return {ok:true,answer:data.answer||'',results:(data.results||[]).map((x:any)=>({title:x.title,url:x.url,content:String(x.content||'').slice(0,1200)}))}
 }
 if(name==='run_code'){
  const language=String(args.language||'')
  const code=String(args.code||'')
  if(!['javascript','python'].includes(language)||!code||code.length>12000)return {ok:false,error:'仅支持长度不超过 12000 字符的 JavaScript/Python 代码。'}
  const id=randomUUID()
  sendEvent(res,{approval:{id,action:'run_code',summary:'即将在隔离的 Piston 远程沙箱运行 '+language+' 代码。请确认代码不会访问敏感数据。',code:code.slice(0,2500)}})
  const approved=await new Promise<boolean>(resolve=>{pendingApprovals.set(id,resolve);setTimeout(()=>{if(pendingApprovals.has(id)){pendingApprovals.delete(id);resolve(false)}},60000)})
  if(!approved)return {ok:false,error:'用户拒绝或审批超时，代码未执行。'}
  const runtime=language==='python'?'python':'javascript'
  const version=language==='python'?'3.10.0':'18.15.0'
  const response=await fetch('https://emkc.org/api/v2/piston/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:runtime,version,files:[{content:code}],stdin:'',run_timeout:5000,compile_timeout:5000})})
  if(!response.ok)return {ok:false,error:'远程沙箱请求失败：'+response.status}
  const data:any=await response.json()
  return {ok:true,stdout:String(data.run?.stdout||'').slice(0,8000),stderr:String(data.run?.stderr||'').slice(0,4000),exitCode:data.run?.code}
 }
 return {ok:false,error:'该工具不存在或未开放。'}
}
app.get('/api/health',(_req,res)=>res.json({ok:true,configuredProviders:Object.values(providers).filter(p=>Boolean(process.env[p.envKey])).length,tools:['calculator','get_current_time','web_search','run_code']}))
app.get('/api/providers',(_req,res)=>res.json({providers:Object.entries(providers).map(([id,p])=>({id,label:p.label,configured:Boolean(process.env[p.envKey]),models:p.models}))}))
app.get('/api/tools',(_req,res)=>res.json({tools:[
 {id:'calculator',name:'计算器',description:'安全数学表达式计算',enabled:true,approval:false},
 {id:'get_current_time',name:'当前时间',description:'时区时间查询',enabled:true,approval:false},
 {id:'web_search',name:'联网搜索',description:'Tavily 实时网页搜索',enabled:Boolean(process.env.TAVILY_API_KEY),approval:false},
 {id:'run_code',name:'代码沙箱',description:'Piston 远程隔离执行，执行前需要审批',enabled:true,approval:true}
]}))
app.use('/api', (req,res,next)=>{if(['/api/health','/api/providers','/api/tools','/api/auth/register','/api/auth/login','/api/auth/me','/api/auth/logout'].includes(req.path))return next();return requireAuth(req as AuthRequest,res,next)})
app.get('/api/chats',(req:AuthRequest,res)=>{const rows=db.prepare('SELECT id,title,data,updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC').all(req.user!.id) as any[];res.json({chats:rows.map(x=>({id:x.id,title:x.title,data:JSON.parse(x.data),updatedAt:x.updated_at}))})})
app.put('/api/chats/:id',(req:AuthRequest,res)=>{const id=String(req.params.id).slice(0,100),title=String(req.body?.title||'新的对话').slice(0,120),data=req.body?.data;if(!id||!Array.isArray(data)||data.length>500)return res.status(400).json({error:'会话数据格式无效。'});const updatedAt=new Date().toISOString();db.prepare('INSERT INTO conversations(id,user_id,title,data,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET title=excluded.title,data=excluded.data,updated_at=excluded.updated_at').run(id,req.user!.id,title,JSON.stringify(data),updatedAt);res.json({ok:true,updatedAt})})
app.delete('/api/chats/:id',(req:AuthRequest,res)=>{db.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').run(req.params.id,req.user!.id);res.json({ok:true})})
app.post('/api/approvals/:id',(req,res)=>{const resolve=pendingApprovals.get(req.params.id);if(!resolve)return res.status(404).json({error:'审批请求已过期或不存在。'});pendingApprovals.delete(req.params.id);resolve(req.body?.approved===true);res.json({ok:true})})
app.post('/api/files',upload.single('file'),async(req,res)=>{
 const file=req.file
 if(!file)return res.status(400).json({error:'请选择文件。'})
 const name=file.originalname.toLowerCase()
 try{
  let content=''
  if(name.endsWith('.pdf')||file.mimetype==='application/pdf'){const parsed=await pdfParse(file.buffer);content=parsed.text}
  else if(/\.(txt|md|csv|json|log)$/i.test(name)||['text/plain','text/markdown','text/csv','application/json'].includes(file.mimetype)){content=file.buffer.toString('utf8')}
  else return res.status(415).json({error:'当前支持 PDF、TXT、MD、CSV、JSON、LOG 文件。'})
  if(!content.trim())return res.status(422).json({error:'文件没有可读取的文本内容。'})
  res.json({name:file.originalname,characters:content.length,content:content.slice(0,10000),truncated:content.length>10000})
 }catch{return res.status(422).json({error:'文件解析失败或格式损坏。'})}
})
app.post('/api/chat',async(req,res)=>{
 const {messages,model,provider:requestedProvider,enabledTools=[]}=req.body??{}
 const providerId=(requestedProvider||'openai') as ProviderId
 const config=providers[providerId]
 if(!config)return res.status(400).json({error:'不支持的模型服务商。'})
 const apiKey=process.env[config.envKey]
 if(!apiKey)return res.status(503).json({error:config.label+' 尚未配置 API Key，请在服务端 .env 中填写 '+config.envKey+'。'})
 if(!Array.isArray(messages)||messages.length===0||messages.length>40)return res.status(400).json({error:'messages 必须是 1 到 40 条消息的数组。'})
 const safeMessages:ChatMessage[]=[]
 for(const m of messages){if(!['user','assistant','system'].includes(m?.role)||typeof m?.content!=='string')return res.status(400).json({error:'消息格式无效。'});safeMessages.push({role:m.role,content:m.content.slice(0,12000)})}
 const selectedModel=String(model||config.models[0])
 if(!config.models.includes(selectedModel)&&providerId!=='custom')return res.status(400).json({error:'所选模型不属于当前服务商。'})
 const baseUrl=config.baseUrl.replace(/\/$/,'')
 if(!baseUrl)return res.status(400).json({error:'请先设置 CUSTOM_BASE_URL。'})
 const isClaude=config.protocol==='anthropic'
 const systemText=safeMessages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n')
 const chatMessages=safeMessages.filter(m=>m.role!=='system')
 const known=['calculator','get_current_time','web_search','run_code']
 const allowedTools=Array.isArray(enabledTools)?enabledTools.filter((x:string)=>known.includes(x)):[]
 res.status(200);res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders?.()
 const headers:Record<string,string>={'Content-Type':'application/json'}
 if(isClaude){headers['x-api-key']=apiKey;headers['anthropic-version']='2023-06-01'}else headers.Authorization='Bearer '+apiKey
 const executeOpenAI=async(history:ChatMessage[])=>{const response=await fetch(baseUrl+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model:selectedModel,messages:history,...(allowedTools.length?{tools:toolSpecs.filter(t=>allowedTools.includes(t.function.name)),tool_choice:'auto'}:{})})});if(!response.ok)throw new Error((await response.text()).slice(0,1000)||'模型请求失败');return response.json()}
 const executeClaude=async(history:any[])=>{const claudeTools=[
  {name:'calculator',description:'计算数学表达式。',input_schema:{type:'object',properties:{expression:{type:'string'}},required:['expression']}},
  {name:'get_current_time',description:'查询指定时区当前时间。',input_schema:{type:'object',properties:{timezone:{type:'string'}}}},
  {name:'web_search',description:'联网搜索网页资料。',input_schema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'run_code',description:'需要用户审批后在远程隔离沙箱运行代码。',input_schema:{type:'object',properties:{language:{type:'string',enum:['javascript','python']},code:{type:'string'}},required:['language','code']}}
 ].filter(t=>allowedTools.includes(t.name))
 const response=await fetch(baseUrl+'/v1/messages',{method:'POST',headers,body:JSON.stringify({model:selectedModel,max_tokens:4096,stream:false,...(systemText?{system:systemText}:{}),messages:history.filter(m=>m.role!=='system'),...(claudeTools.length?{tools:claudeTools}:{})})});if(!response.ok)throw new Error((await response.text()).slice(0,1000)||'Claude 请求失败');return response.json()}
 try{
  let answer=''
  if(isClaude){
   let history:any[]=chatMessages
   for(let step=0;step<6;step++){
    const result=await executeClaude(history);const blocks=result.content||[];const text=blocks.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('');const calls=blocks.filter((b:any)=>b.type==='tool_use')
    if(!calls.length){answer=text;break}
    history=[...history,{role:'assistant',content:blocks}]
    const toolResults=[]
    for(const call of calls){sendEvent(res,{tool:{name:call.name,status:'running',input:call.input}});const output=await executeTool(call.name,JSON.stringify(call.input),res);sendEvent(res,{tool:{name:call.name,status:'completed',output}});toolResults.push({type:'tool_result',tool_use_id:call.id,content:JSON.stringify(output)})}
    history.push({role:'user',content:toolResults})
   }
  }else{
   let history=[...safeMessages]
   for(let step=0;step<6;step++){
    const result=await executeOpenAI(history);const choice=result.choices?.[0]?.message;if(!choice)throw new Error('模型没有返回有效消息。')
    const calls=choice.tool_calls||[];if(!calls.length){answer=choice.content||'';break}
    history.push({role:'assistant',content:choice.content||'',tool_calls:calls})
    for(const call of calls){const name=call.function?.name||'';const args=call.function?.arguments||'{}';sendEvent(res,{tool:{name,status:'running',input:args}});const output=await executeTool(name,args,res);sendEvent(res,{tool:{name,status:'completed',output}});history.push({role:'tool',tool_call_id:call.id,name,content:JSON.stringify(output)})}
   }
  }
  if(answer)sendEvent(res,{text:answer});else sendEvent(res,{error:'Agent 达到最大工具调用轮数，或模型没有生成最终答复。'})
  sendEvent(res,'[DONE]')
 }catch(error){sendEvent(res,{error:error instanceof Error?error.message:'模型请求失败。'})}finally{res.end()}
})
app.listen(port,'127.0.0.1',()=>console.log('MyAgent API server listening on http://127.0.0.1:'+port))
