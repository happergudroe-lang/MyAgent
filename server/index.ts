import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import pdfParse from 'pdf-parse'
import { evaluate } from 'mathjs'
import { randomUUID, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { rateLimit } from 'express-rate-limit'
import path from 'node:path'
import { Pool } from 'pg'

const app = express()
app.disable('x-powered-by')
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(self), geolocation=()');next()})
app.use(express.json({ limit: '5mb' }))
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required. Add the Supabase connection pooler URL in Vercel Environment Variables.')
const db = new Pool({ connectionString: databaseUrl, max: Number(process.env.PG_POOL_MAX || 5), idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, ...(process.env.NODE_ENV === 'production' ? { ssl: { rejectUnauthorized: false } } : {}) })
const query = (text: string, values: unknown[] = []) => db.query(text, values)
async function ensureMemorySchema(){await query(`CREATE TABLE IF NOT EXISTS public.user_memories (user_id text primary key references public.users(id) on delete cascade,summary text not null default '',updated_at timestamptz not null default now())`)}
async function ensureWorkspaceSchema(){await query(`CREATE TABLE IF NOT EXISTS public.workspaces (id text primary key,user_id text not null references public.users(id) on delete cascade,name text not null,description text not null default '',created_at timestamptz not null default now())`);await query(`ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS workspace_id text`);await query(`CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON public.conversations(user_id,workspace_id,updated_at desc)`) }
const hashToken=(token:string)=>createHash('sha256').update(token).digest('hex')
const COOKIE='myagent_session'
const authLimiter=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'尝试次数过多，请 15 分钟后再试。'}})
const chatLimiter=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'请求过于频繁，请 15 分钟后再试。'}})
const externalApiLimiter=rateLimit({windowMs:15*60*1000,limit:120,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{message:'Rate limit exceeded.',type:'rate_limit_error'}}})
function readCookie(req:express.Request,name:string){const raw=req.headers.cookie||'';for(const part of raw.split(';')){const [key,...value]=part.trim().split('=');if(key===name)return decodeURIComponent(value.join('='))}return ''}
function setSessionCookie(res:express.Response,token:string){res.setHeader('Set-Cookie',COOKIE+'='+encodeURIComponent(token)+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800'+(process.env.NODE_ENV==='production'?'; Secure':''))}
function clearSessionCookie(res:express.Response){res.setHeader('Set-Cookie',COOKIE+'=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'+(process.env.NODE_ENV==='production'?'; Secure':''))}
type AuthRequest=express.Request & {user?:{id:string,email:string,username:string}}
async function requireAuth(req:AuthRequest,res:express.Response,next:express.NextFunction){
 try {
  const token=readCookie(req,COOKIE)
  if(!token)return res.status(401).json({error:'请先登录。'})
  const sessionResult=await query('SELECT user_id, expires_at FROM sessions WHERE token_hash=$1',[hashToken(token)])
  const session=sessionResult.rows[0] as {user_id:string,expires_at:string|number}|undefined
  if(!session||Number(session.expires_at)<Date.now()){if(session)await query('DELETE FROM sessions WHERE token_hash=$1',[hashToken(token)]);clearSessionCookie(res);return res.status(401).json({error:'登录已过期，请重新登录。'})}
  const userResult=await query('SELECT id,email,username FROM users WHERE id=$1',[session.user_id])
  const user=userResult.rows[0] as {id:string,email:string,username:string}|undefined
  if(!user){clearSessionCookie(res);return res.status(401).json({error:'账号不存在，请重新登录。'})}
  req.user=user;next()
 } catch {res.status(503).json({error:'数据库暂时不可用，请稍后重试。'})}
}
app.post('/api/auth/register',authLimiter,async(req,res)=>{
 try {
  const email=String(req.body?.email||'').trim().toLowerCase(),username=String(req.body?.username||'').trim(),password=String(req.body?.password||'')
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return res.status(400).json({error:'请输入有效的邮箱地址。'})
  if(username.length<2||username.length>32)return res.status(400).json({error:'用户名需要为 2–32 个字符。'})
  if(password.length<10||password.length>128)return res.status(400).json({error:'密码长度需要为 10–128 位。'})
  const exists=await query('SELECT id FROM users WHERE lower(email)=lower($1)',[email])
  if(exists.rowCount)return res.status(409).json({error:'该邮箱已注册，请直接登录。'})
  const id=randomUUID(),passwordHash=await bcrypt.hash(password,12),createdAt=new Date().toISOString()
  await query('INSERT INTO users(id,email,username,password_hash,created_at) VALUES($1,$2,$3,$4,$5)',[id,email,username,passwordHash,createdAt])
  const token=randomUUID()+randomUUID()
  await query('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES($1,$2,$3,$4)',[hashToken(token),id,Date.now()+7*86400000,createdAt])
  setSessionCookie(res,token);res.status(201).json({user:{id,email,username}})
 } catch(error) {if((error as {code?:string})?.code==='23505')return res.status(409).json({error:'该邮箱已注册，请直接登录。'});res.status(500).json({error:'注册失败，请稍后重试。'})}
})
app.post('/api/auth/login',authLimiter,async(req,res)=>{
 try {
  const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'')
  const result=await query('SELECT id,email,username,password_hash FROM users WHERE lower(email)=lower($1)',[email]),user=result.rows[0] as any
  if(!user||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({error:'邮箱或密码不正确。'})
  const token=randomUUID()+randomUUID(),createdAt=new Date().toISOString()
  await query('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES($1,$2,$3,$4)',[hashToken(token),user.id,Date.now()+7*86400000,createdAt])
  setSessionCookie(res,token);res.json({user:{id:user.id,email:user.email,username:user.username}})
 } catch {res.status(500).json({error:'登录失败，请稍后重试。'})}
})
app.get('/api/auth/me',requireAuth,(req:AuthRequest,res)=>res.json({user:req.user}))
app.post('/api/auth/logout',requireAuth,async(req:AuthRequest,res)=>{await query('DELETE FROM sessions WHERE token_hash=$1',[hashToken(readCookie(req,COOKIE))]);clearSessionCookie(res);res.json({ok:true})})

const port = Number(process.env.PORT || 3001)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } })
type ProviderId = 'my' | 'openai' | 'deepseek' | 'claude' | 'gemini' | 'qwen' | 'custom'
type ChatMessage = { role: string; content: any; tool_calls?: any[]; tool_call_id?: string; name?: string }
const providers: Record<ProviderId, { label: string; envKey: string; baseUrl: string; protocol: 'openai' | 'anthropic'; models: string[] }> = {
 my:{label:'MyAgent 智能模型',envKey:'MY_API_KEY',baseUrl:process.env.MY_BASE_URL||'',protocol:'openai',models:[process.env.MY_MODEL||'myrqvia']},
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
const hasHostedModel=()=>Boolean(process.env.MY_API_KEY?.trim()&&process.env.MY_BASE_URL?.trim())
app.get('/api/health',(req,res)=>res.json({ok:true,configuredProviders:Object.entries(providers).filter(([id,p])=>id==='my'?hasHostedModel():Boolean(process.env[p.envKey])).length,tools:['calculator','get_current_time','web_search','run_code']}))
app.get('/api/providers',(req,res)=>res.json({providers:Object.entries(providers).map(([id,p])=>({id,label:p.label,configured:id==='my'?hasHostedModel():Boolean(process.env[p.envKey]),models:p.models}))}))
app.get('/api/tools',(_req,res)=>res.json({tools:[
 {id:'calculator',name:'计算器',description:'安全数学表达式计算',enabled:true,approval:false},
 {id:'get_current_time',name:'当前时间',description:'时区时间查询',enabled:true,approval:false},
 {id:'web_search',name:'联网搜索',description:'Tavily 实时网页搜索',enabled:Boolean(process.env.TAVILY_API_KEY),approval:false},
 {id:'run_code',name:'代码沙箱',description:'Piston 远程隔离执行，执行前需要审批',enabled:!process.env.VERCEL,approval:true}
]}))
app.use('/api', (req,res,next)=>{if(['/api/health','/api/providers','/api/tools','/api/auth/register','/api/auth/login','/api/auth/me','/api/auth/logout'].includes(req.path))return next();return requireAuth(req as AuthRequest,res,next)})
app.get('/api/workspaces',async(req:AuthRequest,res)=>{try{await ensureWorkspaceSchema();const r=await query('SELECT id,name,description,created_at FROM workspaces WHERE user_id=$1 ORDER BY created_at DESC',[req.user!.id]);res.json({workspaces:r.rows})}catch{res.status(500).json({error:'读取工作区失败。'})}})
app.post('/api/workspaces',async(req:AuthRequest,res)=>{try{await ensureWorkspaceSchema();const name=String(req.body?.name||'').trim().slice(0,60),description=String(req.body?.description||'').trim().slice(0,240);if(name.length<2)return res.status(400).json({error:'工作区名称至少需要 2 个字符。'});const id=randomUUID();const r=await query('INSERT INTO workspaces(id,user_id,name,description) VALUES($1,$2,$3,$4) RETURNING id,name,description,created_at',[id,req.user!.id,name,description]);res.status(201).json({workspace:r.rows[0]})}catch{res.status(500).json({error:'创建工作区失败。'})}})
app.delete('/api/workspaces/:id',async(req:AuthRequest,res)=>{try{await ensureWorkspaceSchema();const id=String(req.params.id);await query('UPDATE conversations SET workspace_id=NULL WHERE user_id=$1 AND workspace_id=$2',[req.user!.id,id]);await query('DELETE FROM workspaces WHERE id=$1 AND user_id=$2',[id,req.user!.id]);res.json({ok:true})}catch{res.status(500).json({error:'删除工作区失败。'})}})
app.get('/api/chats',async(req:AuthRequest,res)=>{try{await ensureWorkspaceSchema();const workspaceId=String(req.query.workspaceId||'');const r=workspaceId?await query('SELECT id,title,data,updated_at,workspace_id FROM conversations WHERE user_id=$1 AND workspace_id=$2 ORDER BY updated_at DESC',[req.user!.id,workspaceId]):await query('SELECT id,title,data,updated_at,workspace_id FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC',[req.user!.id]);res.json({chats:r.rows.map(x=>({id:x.id,title:x.title,data:x.data,updatedAt:x.updated_at,workspaceId:x.workspace_id}))})}catch{res.status(500).json({error:'读取会话失败。'})}})
app.get('/api/chats/:id',async(req:AuthRequest,res)=>{try{await ensureWorkspaceSchema();const r=await query('SELECT id,title,data,updated_at,workspace_id FROM conversations WHERE id=$1 AND user_id=$2',[req.params.id,req.user!.id]);const row=r.rows[0];if(!row)return res.status(404).json({error:'会话不存在。'});res.json({chat:{id:row.id,title:row.title,data:row.data,updatedAt:row.updated_at,workspaceId:row.workspace_id}})}catch{res.status(500).json({error:'读取会话失败。'})}})
app.put('/api/chats/:id',async(req:AuthRequest,res)=>{try{await ensureWorkspaceSchema();const id=String(req.params.id).slice(0,100),title=String(req.body?.title||'新的对话').slice(0,120),data=req.body?.data,workspaceId=req.body?.workspaceId?String(req.body.workspaceId):null;if(!id||!Array.isArray(data)||data.length>500)return res.status(400).json({error:'会话数据格式无效。'});if(workspaceId){const w=await query('SELECT id FROM workspaces WHERE id=$1 AND user_id=$2',[workspaceId,req.user!.id]);if(!w.rowCount)return res.status(404).json({error:'工作区不存在。'})}const updatedAt=new Date().toISOString();await query('INSERT INTO conversations(id,user_id,title,data,updated_at,workspace_id) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(user_id,id) DO UPDATE SET title=EXCLUDED.title,data=EXCLUDED.data,updated_at=EXCLUDED.updated_at,workspace_id=EXCLUDED.workspace_id',[id,req.user!.id,title,JSON.stringify(data),updatedAt,workspaceId]);res.json({ok:true,updatedAt})}catch{res.status(500).json({error:'保存会话失败。'})}})
app.patch('/api/chats/:id',async(req:AuthRequest,res)=>{try{const id=String(req.params.id).slice(0,100),title=String(req.body?.title||'').trim().slice(0,120);if(title.length<1)return res.status(400).json({error:'聊天名称不能为空。'});const r=await query('UPDATE conversations SET title=$1,updated_at=$2 WHERE id=$3 AND user_id=$4 RETURNING id,title',[title,new Date().toISOString(),id,req.user!.id]);if(!r.rowCount)return res.status(404).json({error:'会话不存在。'});res.json({ok:true,chat:r.rows[0]})}catch{res.status(500).json({error:'重命名失败。'})}})
app.delete('/api/chats/:id',async(req:AuthRequest,res)=>{try{await query('DELETE FROM conversations WHERE id=$1 AND user_id=$2',[req.params.id,req.user!.id]);res.json({ok:true})}catch{res.status(500).json({error:'删除会话失败。'})}})
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

function requireExternalApiKey(req:express.Request,res:express.Response,next:express.NextFunction){
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS')
 if(req.method==='OPTIONS')return res.status(204).end()
 const expected=process.env.MYAGENT_CLIENT_API_KEY||''
 if(!expected)return res.status(503).json({error:{message:'External API access is not configured.',type:'api_error'}})
 const supplied=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim()
 if(!supplied||supplied!==expected)return res.status(401).json({error:{message:'Invalid API key.',type:'authentication_error'}})
 next()
}
app.get('/v1/models',externalApiLimiter,requireExternalApiKey,(_req,res)=>res.json({object:'list',data:[{id:process.env.MY_MODEL||'myrqvia',object:'model',created:0,owned_by:'myagent'}]}))
app.post('/v1/chat/completions',externalApiLimiter,requireExternalApiKey,async(req,res)=>{
 const baseUrl=String(process.env.MY_BASE_URL||'').replace(/\/$/,'')
 const apiKey=process.env.MY_API_KEY||''
 if(!baseUrl||!apiKey)return res.status(503).json({error:{message:'Hosted model is not configured.',type:'api_error'}})
 const body={...(req.body||{}),model:String(req.body?.model||process.env.MY_MODEL||'myrqvia')}
 try{const upstream=await fetch(baseUrl+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify(body)});res.status(upstream.status);res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json');res.setHeader('Cache-Control','no-cache, no-transform');if(!upstream.body)return res.end();const reader=upstream.body.getReader();while(true){const {value,done}=await reader.read();if(done)break;if(!res.write(value))await new Promise<void>(resolve=>res.once('drain',resolve))}res.end()}catch(error){console.error('[MyAgent] External chat proxy failed:',error instanceof Error?error.message:'unknown');if(!res.headersSent)res.status(502).json({error:{message:'Upstream model is temporarily unavailable.',type:'api_error'}});else res.end()}
})
app.post('/v1/completions',externalApiLimiter,requireExternalApiKey,async(req,res)=>{
 const baseUrl=String(process.env.MY_BASE_URL||'').replace(/\/$/,'')
 const apiKey=process.env.MY_API_KEY||''
 if(!baseUrl||!apiKey)return res.status(503).json({error:{message:'Hosted model is not configured.',type:'api_error'}})
 try{const upstream=await fetch(baseUrl+'/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify({...req.body,model:String(req.body?.model||process.env.MY_MODEL||'myrqvia')})});res.status(upstream.status);res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json');if(!upstream.body)return res.end();const reader=upstream.body.getReader();while(true){const {value,done}=await reader.read();if(done)break;if(!res.write(value))await new Promise<void>(resolve=>res.once('drain',resolve))}res.end()}catch{if(!res.headersSent)res.status(502).json({error:{message:'FIM completion endpoint is unavailable on the local gateway.',type:'api_error'}});else res.end()}
})

app.post('/api/chat',requireAuth,chatLimiter,async(req,res)=>{
 const {messages,model,provider:requestedProvider,enabledTools=[],apiKey:sessionApiKey,baseUrl:requestedBaseUrl}=req.body??{}
 const providerId=(requestedProvider||'my') as ProviderId
 const config=providers[providerId]
 if(!config)return res.status(400).json({error:'不支持的模型服务商。'})
 const hostedApiKey=providerId==='my'?(process.env.MY_API_KEY||''):''
 const apiKey=providerId==='my'?hostedApiKey:(typeof sessionApiKey==='string'&&sessionApiKey.trim().length>0?sessionApiKey.trim():process.env[config.envKey])
 if(!apiKey)return res.status(503).json({error:providerId==='my'?'平台模型服务暂未激活，请稍后重试或联系管理员。':config.label+' 尚未配置 API Key，请在服务端 .env 中填写 '+config.envKey+'。'})
 if(!Array.isArray(messages)||messages.length===0||messages.length>40)return res.status(400).json({error:'messages 必须是 1 到 40 条消息的数组。'})
 const safeMessages:ChatMessage[]=[]
 for(const m of messages){if(!['user','assistant','system'].includes(m?.role)||typeof m?.content!=='string')return res.status(400).json({error:'消息格式无效。'});safeMessages.push({role:m.role,content:m.content.slice(0,12000)})}
 const selectedModel=providerId==='my'?(process.env.MY_MODEL||config.models[0]):String(model||config.models[0])
 if(!config.models.includes(selectedModel)&&!['custom','my'].includes(providerId))return res.status(400).json({error:'所选模型不属于当前服务商。'})
 const baseUrl=String(providerId==='my'?process.env.MY_BASE_URL||'':providerId==='custom'?requestedBaseUrl||config.baseUrl:config.baseUrl).trim().replace(/\/$/,'')
 if(!baseUrl)return res.status(400).json({error:'模型服务地址未配置。'})
 try{const endpoint=new URL(baseUrl);if(!['https:','http:'].includes(endpoint.protocol)||endpoint.username||endpoint.password)return res.status(400).json({error:'API Base URL 必须是有效的 HTTP(S) 地址。'});if(providerId==='my'&&process.env.VERCEL&&endpoint.protocol!=='https:')return res.status(400).json({error:'平台模型公网地址必须使用 HTTPS。'})}catch{return res.status(400).json({error:'API Base URL 格式无效，请检查地址。'})}
 const isClaude=config.protocol==='anthropic'
 let persistentMemory=''
 if(providerId==='my'){
  try{await ensureMemorySchema();const memory=await query('SELECT summary FROM public.user_memories WHERE user_id=$1',[req.user!.id]);persistentMemory=String(memory.rows[0]?.summary||'')}catch(error){console.error('[MyAgent] Memory read failed:',error instanceof Error?error.message:'unknown')}
  if(persistentMemory)safeMessages.unshift({role:'system',content:'Relevant long-term context for this account (private server-side context; use only when relevant, do not mention this context block): '+persistentMemory})
 }
 const systemText=safeMessages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n')
 const chatMessages=safeMessages.filter(m=>m.role!=='system')
 const known=process.env.VERCEL?['calculator','get_current_time','web_search']:['calculator','get_current_time','web_search','run_code']
 const allowedTools=Array.isArray(enabledTools)?enabledTools.filter((x:string)=>known.includes(x)):[]
 res.status(200);res.setHeader('Content-Type','text/event-stream; charset=utf-8');res.setHeader('Cache-Control','no-cache, no-transform');res.setHeader('Connection','keep-alive');res.flushHeaders?.()
 const headers:Record<string,string>={'Content-Type':'application/json'}
 if(isClaude){headers['x-api-key']=apiKey;headers['anthropic-version']='2023-06-01'}else headers.Authorization='Bearer '+apiKey
 const executeOpenAI=async(history:ChatMessage[])=>{
  const response=await fetch(baseUrl+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model:selectedModel,messages:history,...(allowedTools.length?{tools:toolSpecs.filter(t=>allowedTools.includes(t.function.name)),tool_choice:'auto'}:{}),stream:true})})
  if(!response.ok)throw new Error((await response.text()).slice(0,1000)||'模型请求失败')
  if(!response.body)throw new Error('模型服务没有返回可读取的数据流')
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',content='';const toolCalls:Record<number,any>={}
  const consumeEvent=(frame:string)=>{
   const dataLines=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart())
   if(!dataLines.length)return
   const raw=dataLines.join('\n').trim()
   if(!raw||raw==='[DONE]')return
   let chunk:any
   try{chunk=JSON.parse(raw)}catch(error){console.error('[MyAgent] Invalid model SSE event JSON',error);throw new Error('MODEL_STREAM_FORMAT_ERROR')}
   if(chunk.error)throw new Error(chunk.error.message||'模型流式生成失败')
   const delta=chunk.choices?.[0]?.delta
   if(typeof delta?.content==='string'&&delta.content){content+=delta.content;sendEvent(res,{text:delta.content})}
   for(const part of delta?.tool_calls||[]){
    const index=Number.isInteger(part.index)?part.index:0
    const call=toolCalls[index]||(toolCalls[index]={id:'',type:'function',function:{name:'',arguments:''}})
    if(part.id)call.id=part.id
    if(part.type)call.type=part.type
    if(part.function?.name)call.function.name+=part.function.name
    if(typeof part.function?.arguments==='string')call.function.arguments+=part.function.arguments
   }
  }
  const consumeBuffer=(flush=false)=>{
   const frames=buffer.split(/\r?\n\r?\n/)
   buffer=flush?'':(frames.pop()||'')
   for(const frame of frames)consumeEvent(frame)
   if(flush&&buffer.trim())consumeEvent(buffer)
  }
  while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});consumeBuffer()}
  buffer+=decoder.decode();consumeBuffer(true)
  const calls=Object.keys(toolCalls).sort((a,b)=>Number(a)-Number(b)).map(k=>toolCalls[Number(k)])
  for(const call of calls){
   const args=call.function?.arguments||'{}'
   try{JSON.parse(args)}catch(error){console.error('[MyAgent] Invalid assembled tool arguments',error);throw new Error('MODEL_TOOL_ARGUMENTS_ERROR')}
  }
  return {choices:[{message:{content,tool_calls:calls}}]}
 }
 const executeClaude=async(history:any[])=>{const claudeTools=[
  {name:'calculator',description:'计算数学表达式。',input_schema:{type:'object',properties:{expression:{type:'string'}},required:['expression']}},
  {name:'get_current_time',description:'查询指定时区当前时间。',input_schema:{type:'object',properties:{timezone:{type:'string'}}}},
  {name:'web_search',description:'联网搜索网页资料。',input_schema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'run_code',description:'需要用户审批后在远程隔离沙箱运行代码。',input_schema:{type:'object',properties:{language:{type:'string',enum:['javascript','python']},code:{type:'string'}},required:['language','code']}}
 ].filter(t=>allowedTools.includes(t.name))
 const response=await fetch(baseUrl+'/v1/messages',{method:'POST',headers,body:JSON.stringify({model:selectedModel,max_tokens:4096,stream:true,...(systemText?{system:systemText}:{}),messages:history.filter(m=>m.role!=='system'),...(claudeTools.length?{tools:claudeTools}:{})})})
 if(!response.ok)throw new Error((await response.text()).slice(0,1000)||'Claude 请求失败')
 if(!response.body)throw new Error('Claude 没有返回可读取的数据流')
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';const blocks:Record<number,any>={}
 const consume=(line:string)=>{if(!line.startsWith('data:'))return;const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')return;const event=JSON.parse(raw);if(event.type==='error')throw new Error(event.error?.message||'Claude 流式生成失败');if(event.type==='content_block_start'){const block={...(event.content_block||{})};if(block.type==='text')block.text=block.text||'';if(block.type==='tool_use'){block.input=block.input||{};(block as any).partialJson=''}blocks[Number(event.index||0)]=block}else if(event.type==='content_block_delta'){const block=blocks[Number(event.index||0)];if(!block)return;if(event.delta?.type==='text_delta'&&typeof event.delta.text==='string'){block.text=(block.text||'')+event.delta.text;sendEvent(res,{text:event.delta.text})}if(event.delta?.type==='input_json_delta')(block as any).partialJson=((block as any).partialJson||'')+String(event.delta.partial_json||'')}else if(event.type==='content_block_stop'){const block=blocks[Number(event.index||0)];if(block?.type==='tool_use'&&(block as any).partialJson){try{block.input=JSON.parse((block as any).partialJson)}catch{throw new Error('Claude 工具参数格式无效。')}}}}
 while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true}).replace(/\\r\\n/g,'\\n');const lines=buffer.split('\\n');buffer=lines.pop()||'';for(const line of lines)consume(line)}
 buffer+=decoder.decode();if(buffer.trim())consume(buffer)
 return {content:Object.keys(blocks).sort((a,b)=>Number(a)-Number(b)).map(k=>{const block={...blocks[Number(k)]};delete block.partialJson;return block})}}
 try{
  let answer=''
  if(!isClaude&&allowedTools.length===0){
   const response=await fetch(baseUrl+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model:selectedModel,messages:safeMessages,stream:true})})
   if(!response.ok)throw new Error((await response.text()).slice(0,1000)||'模型请求失败')
   if(!response.body)throw new Error('模型服务没有返回可读取的数据流')
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer=''
   while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines){if(!line.startsWith('data:'))continue;const raw=line.slice(5).trim();if(!raw||raw==='[DONE]')continue;const chunk=JSON.parse(raw);const delta=chunk.choices?.[0]?.delta?.content;if(typeof delta==='string'&&delta){answer+=delta;sendEvent(res,{text:delta})}if(chunk.error)throw new Error(chunk.error.message||'模型流式生成失败')}} 
   if(!answer)throw new Error('模型没有返回文本内容。')
  }else if(isClaude){
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
  if(!answer)sendEvent(res,{error:'Agent 达到最大工具调用轮数，或模型没有生成最终答复。'})

  if(providerId==='my'&&answer.trim()){
   const transcript=[...chatMessages.slice(-10),{role:'assistant',content:answer}].map(m=>m.role.toUpperCase()+': '+String(m.content||'').slice(0,2500)).join('\n\n').slice(-14000)
   const previousMemory=persistentMemory
   void (async()=>{try{
    const memoryResponse=await fetch(baseUrl+'/chat/completions',{method:'POST',headers,body:JSON.stringify({model:selectedModel,temperature:0.2,max_tokens:500,stream:false,messages:[{role:'system',content:'Maintain a concise private memory for this account. Extract only stable user preferences, communication preferences, long-running projects and explicit constraints useful in future conversations. Never store passwords, API keys, tokens, financial identifiers, precise addresses, health details, or sensitive personal traits. Do not infer sensitive traits. Preserve still-relevant prior memory. Return only JSON: {"summary":"..."}; summary must be under 2500 Chinese characters. If nothing useful, return the previous summary unchanged.'},{role:'user',content:'Previous memory:\n'+previousMemory+'\n\nRecent conversation:\n'+transcript}]})})
    if(!memoryResponse.ok)return
    const memoryJson:any=await memoryResponse.json(),raw=String(memoryJson.choices?.[0]?.message?.content||'').trim()
    const parsed=JSON.parse(raw.replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,''))
    const summary=String(parsed.summary||'').trim().slice(0,10000)
    if(summary)await query('INSERT INTO public.user_memories(user_id,summary,updated_at) VALUES($1,$2,now()) ON CONFLICT(user_id) DO UPDATE SET summary=EXCLUDED.summary,updated_at=now()',[req.user!.id,summary])
   }catch(error){console.error('[MyAgent] Memory update failed:',error instanceof Error?error.message:'unknown')}})()
  }
  sendEvent(res,'[DONE]')
 }catch(error){const detail=error instanceof Error?error.message:'未知错误';console.error('[MyAgent] Chat generation failed:',detail);const friendly=detail==='MODEL_STREAM_FORMAT_ERROR'||detail==='MODEL_TOOL_ARGUMENTS_ERROR'?'模型返回格式异常，请重试。':/Unexpected non-whitespace character|JSON at position|JSON.parse/i.test(detail)?'模型返回格式异常，请重试。':/AbortError|aborted/i.test(detail)?'生成已中断，请重试。':'模型暂时无法完成请求，请稍后重试。';sendEvent(res,{error:friendly})}finally{res.end()}
})
if (!process.env.VERCEL) { app.use(express.static(path.resolve(process.cwd(),'dist'))); app.get('*',(req,res,next)=>{if(req.path.startsWith('/api/'))return next();res.sendFile(path.resolve(process.cwd(),'dist/index.html'))}); app.listen(port,'0.0.0.0',()=>console.log('MyAgent server listening on 0.0.0.0:'+port)) }
export default app
