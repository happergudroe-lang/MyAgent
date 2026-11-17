type VoiceProviderId = 'local' | 'openai' | 'elevenlabs' | 'minimax' | 'fish'

const openAiVoices = ['alloy','ash','ballad','coral','echo','fable','marin','cedar','nova','onyx','sage','shimmer','verse']
const localTtsUrl = (process.env.VOICE_STUDIO_URL || 'http://127.0.0.1:3900').replace(/\/$/, '')
const localAsrUrl = (process.env.VOICE_STUDIO_ASR_URL || localTtsUrl).replace(/\/$/, '')
const provider = (process.env.VOICE_PROVIDER || 'local').toLowerCase() as VoiceProviderId
const openAiKey = process.env.OPENAI_API_KEY || ''
const elevenKey = process.env.ELEVENLABS_API_KEY || ''
const minimaxKey = process.env.MINIMAX_API_KEY || ''
const fishKey = process.env.FISH_AUDIO_API_KEY || ''
const fishDefaultVoiceId = process.env.FISH_AUDIO_VOICE_ID || ''
const minimaxGroupId = process.env.MINIMAX_GROUP_ID || ''

export type VoiceItem = { id: string; name: string; type: 'profile' | 'preset'; language?: string; provider?: string }
export type VoiceStatus = { provider: VoiceProviderId; providerLabel: string; available: boolean; voices: VoiceItem[]; cloneSupported: boolean; transcribeSupported: boolean; ttsSupported: boolean; error?: string; latencyMs: number; baseUrl?: string }

function keyFor(id: VoiceProviderId) { return id === 'openai' ? openAiKey : id === 'elevenlabs' ? elevenKey : id === 'minimax' ? minimaxKey : id === 'fish' ? fishKey : '' }
function labelFor(id: VoiceProviderId) { return ({ local: 'VoiceStudio 本地', openai: 'OpenAI TTS', elevenlabs: 'ElevenLabs', minimax: 'MiniMax', fish: 'Fish Audio' } as Record<VoiceProviderId,string>)[id] }
function jsonError(payload: any, fallback: string) { return String(payload?.error?.message || payload?.detail || payload?.message || payload?.error || fallback) }
async function request(url: string, init: RequestInit = {}, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(url, { ...init, signal: controller.signal }) }
  catch (error) { if (controller.signal.aborted) throw new Error('语音服务请求超时'); throw error }
  finally { clearTimeout(timer) }
}
function missingKey(id: VoiceProviderId) { return new Error(labelFor(id) + '尚未配置服务端 API Key。请在部署平台设置对应环境变量。') }

export async function getVoiceProviderStatus(): Promise<VoiceStatus> {
  const started = Date.now()
  if (!['local','openai','elevenlabs','minimax','fish'].includes(provider)) return { provider, providerLabel: '未知语音 Provider', available: false, voices: [], cloneSupported: false, transcribeSupported: false, ttsSupported: false, error: 'VOICE_PROVIDER 配置值无效。', latencyMs: Date.now()-started }
  if (provider === 'local') {
    try {
      const [health, list] = await Promise.all([request(localTtsUrl + '/health', {}, 2500), request(localTtsUrl + '/v1/audio/voices', {}, 2500)])
      const hp = await health.json().catch(() => ({}))
      const payload: any = await list.json().catch(() => ({}))
      const raw = Array.isArray(payload) ? payload : (payload.voices || payload.data || [])
      const voices = raw.map((v:any) => ({ id:String(v.id || v.voice_id || ''), name:String(v.name || v.id || '未命名音色'), type:(v.type === 'profile' || v.kind === 'profile' ? 'profile' : 'preset') as 'profile'|'preset', language:String(v.language || 'unknown'), provider:'local' })).filter((v:VoiceItem) => v.id)
      const ok = health.ok && list.ok
      return { provider, providerLabel:labelFor(provider), available:ok, voices, cloneSupported:true, transcribeSupported:true, ttsSupported:true, error:ok ? undefined : 'VoiceStudio health 或音色列表接口不可用。', latencyMs:Date.now()-started, baseUrl:localTtsUrl }
    } catch (error) { return { provider, providerLabel:labelFor(provider), available:false, voices:[], cloneSupported:true, transcribeSupported:true, ttsSupported:true, error:error instanceof Error?error.message:'VoiceStudio 连接失败', latencyMs:Date.now()-started, baseUrl:localTtsUrl } }
  }
  if (provider === 'openai') {
    const voices = openAiVoices.map(id => ({ id, name:id[0].toUpperCase()+id.slice(1), type:'preset' as const, language:'多语言（英语音色优化）', provider }))
    if (!openAiKey) return { provider, providerLabel:labelFor(provider), available:false, voices, cloneSupported:false, transcribeSupported:false, ttsSupported:false, error:'缺少 OPENAI_API_KEY。', latencyMs:Date.now()-started }
    try {
      const ping = await request('https://api.openai.com/v1/models', { headers:{Authorization:'Bearer '+openAiKey} }, 8000)
      if (!ping.ok) { const data:any=await ping.json().catch(()=>({})); throw new Error(jsonError(data,'OpenAI API 鉴权失败（HTTP '+ping.status+'）')) }
      return { provider, providerLabel:labelFor(provider), available:true, voices, cloneSupported:false, transcribeSupported:true, ttsSupported:true, latencyMs:Date.now()-started }
    } catch(error) { return { provider, providerLabel:labelFor(provider), available:false, voices, cloneSupported:false, transcribeSupported:false, ttsSupported:false, error:error instanceof Error?error.message:'OpenAI API 不可用', latencyMs:Date.now()-started } }
  }
  if (!keyFor(provider)) return { provider, providerLabel:labelFor(provider), available:false, voices:[], cloneSupported:false, transcribeSupported:false, ttsSupported:false, error:provider==='elevenlabs'?'缺少 ELEVENLABS_API_KEY。':provider==='minimax'?'缺少 MINIMAX_API_KEY。':'缺少 FISH_AUDIO_API_KEY。', latencyMs:Date.now()-started }
  if (provider === 'elevenlabs') {
    try {
      const response = await request('https://api.elevenlabs.io/v1/voices', { headers:{'xi-api-key':elevenKey} }, 12000)
      const data:any = await response.json().catch(()=>({}))
      if (!response.ok) throw new Error(jsonError(data,'ElevenLabs 音色列表请求失败（HTTP '+response.status+'）'))
      const voices = (data.voices || []).map((v:any)=>({id:String(v.voice_id),name:String(v.name||v.voice_id),type:'profile' as const,language:'多语言',provider})).filter((v:VoiceItem)=>v.id)
      return { provider, providerLabel:labelFor(provider), available:true, voices, cloneSupported:true, transcribeSupported:true, ttsSupported:true, latencyMs:Date.now()-started }
    } catch(error) { return { provider, providerLabel:labelFor(provider), available:false, voices:[], cloneSupported:true, transcribeSupported:true, ttsSupported:true, error:error instanceof Error?error.message:'ElevenLabs 连接失败', latencyMs:Date.now()-started } }
  }
  if (provider === 'minimax') {
    const presets = ['male-qn-jingying','male-qn-qingse','female-shaonv','female-yujie','female-chengshu','female-tianmei','presenter_male','presenter_female','audiobook_male_1','audiobook_female_1']
    const voices = presets.map(id=>({id,name:id,type:'preset' as const,language:'中文及多语言',provider}))
    const ready = Boolean(minimaxKey && minimaxGroupId)
    return { provider, providerLabel:labelFor(provider), available:ready, voices, cloneSupported:false, transcribeSupported:false, ttsSupported:ready, error:ready?undefined:(!minimaxKey?'缺少 MINIMAX_API_KEY。':'缺少 MINIMAX_GROUP_ID。'), latencyMs:Date.now()-started }
  }
  if (provider === 'fish') {
    try {
      const response = await request('https://api.fish.audio/model?page_size=100&page_number=1&self=true&visibility=private', { headers:{Authorization:'Bearer '+fishKey} }, 12000)
      const data:any = await response.json().catch(()=>({}))
      if (!response.ok) throw new Error(jsonError(data,'Fish Audio 音色列表请求失败（HTTP '+response.status+'）'))
      const voices:VoiceItem[] = (data.items||[]).filter((v:any)=>v.state!=='failed').map((v:any)=>({id:String(v._id),name:String(v.title||v._id),type:'profile' as const,language:'自动识别',provider})).filter((v:VoiceItem)=>v.id)
      if (fishDefaultVoiceId && !voices.some(v=>v.id===fishDefaultVoiceId)) voices.unshift({id:fishDefaultVoiceId,name:'默认 Fish Audio 音色',type:'preset',language:'自动识别',provider})
      const ready = voices.length > 0
      return { provider, providerLabel:labelFor(provider), available:ready, voices, cloneSupported:true, transcribeSupported:false, ttsSupported:true, error:ready?undefined:'Fish Audio 账号暂无可用音色；请上传有授权的参考录音创建私有音色。', latencyMs:Date.now()-started }
    } catch(error) { return { provider, providerLabel:labelFor(provider), available:false, voices:[], cloneSupported:true, transcribeSupported:false, ttsSupported:false, error:error instanceof Error?error.message:'Fish Audio 连接失败', latencyMs:Date.now()-started } }
  }
  return { provider, providerLabel:labelFor(provider), available:false, voices:[], cloneSupported:false, transcribeSupported:false, ttsSupported:false, error:'未知语音 Provider。', latencyMs:Date.now()-started }
}

export async function synthesizeVoice(text: string, voiceId: string): Promise<Response> {
  if (provider === 'local') return request(localTtsUrl + '/v1/audio/speech', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:'tts-1',voice:voiceId,input:text,response_format:'mp3'}) }, 180000)
  if (provider === 'openai') {
    if (!openAiKey) throw missingKey(provider)
    if (!openAiVoices.includes(voiceId)) throw new Error('所选音色不属于 OpenAI 预设音色。')
    if (text.length > 4096) throw new Error('OpenAI Speech API 单次文本上限为 4096 字符。')
    return request('https://api.openai.com/v1/audio/speech', { method:'POST', headers:{Authorization:'Bearer '+openAiKey,'Content-Type':'application/json'}, body:JSON.stringify({model:process.env.OPENAI_TTS_MODEL||'gpt-4o-mini-tts',voice:voiceId,input:text,instructions:process.env.OPENAI_TTS_INSTRUCTIONS||'Speak naturally and conversationally. Use clear, warm, expressive delivery.',response_format:'mp3'}) }, 180000)
  }
  if (provider === 'minimax') {
    if (!minimaxKey || !minimaxGroupId) throw new Error('MiniMax 需要同时配置 MINIMAX_API_KEY 和 MINIMAX_GROUP_ID。')
    const response = await request('https://api.minimaxi.com/v1/t2a_v2?GroupId='+encodeURIComponent(minimaxGroupId), { method:'POST', headers:{Authorization:'Bearer '+minimaxKey,'Content-Type':'application/json'}, body:JSON.stringify({model:process.env.MINIMAX_TTS_MODEL||'speech-2.8-turbo',text,stream:false,voice_setting:{voice_id:voiceId,speed:1,vol:1,pitch:0},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}}) }, 180000)
    const payload:any = await response.json().catch(()=>({}))
    if (!response.ok || Number(payload?.base_resp?.status_code||0)!==0) throw new Error(jsonError(payload?.base_resp||payload,'MiniMax TTS 请求失败'))
    const hex = payload?.data?.audio
    if (typeof hex !== 'string' || !hex.length) throw new Error('MiniMax 未返回音频数据。')
    return new Response(Buffer.from(hex,'hex'), { status:200, headers:{'Content-Type':'audio/mpeg'} })
  }
  if (provider === 'elevenlabs') {
    if (!elevenKey) throw missingKey(provider)
    return request('https://api.elevenlabs.io/v1/text-to-speech/'+encodeURIComponent(voiceId), { method:'POST', headers:{'xi-api-key':elevenKey,'Content-Type':'application/json','Accept':'audio/mpeg'}, body:JSON.stringify({text,model_id:process.env.ELEVENLABS_MODEL_ID||'eleven_multilingual_v2',voice_settings:{stability:0.45,similarity_boost:0.8,style:0.25,use_speaker_boost:true}}) }, 180000)
  }
  throw new Error(labelFor(provider)+' TTS 适配器当前不可用。')
}

export async function transcribeVoice(buffer: Buffer, mimeType: string, filename: string): Promise<{text:string;latencyMs:number}> {
  const started = Date.now()
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)], {type:mimeType||'audio/webm'}), filename||'recording.webm')
  if (provider === 'local') {
    form.append('model','whisper-1'); form.append('response_format','json')
    const response = await request(localAsrUrl+'/v1/audio/transcriptions',{method:'POST',body:form},180000)
    const payload:any = await response.json().catch(()=>({}))
    if(!response.ok) throw new Error(jsonError(payload,'VoiceStudio ASR 请求失败'))
    return {text:String(payload.text||'').trim(),latencyMs:Date.now()-started}
  }
  if (provider === 'openai') {
    if(!openAiKey) throw missingKey(provider)
    form.append('model',process.env.OPENAI_ASR_MODEL||'gpt-4o-mini-transcribe')
    form.append('response_format','json')
    const response=await request('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+openAiKey},body:form},180000)
    const payload:any=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(jsonError(payload,'OpenAI 转写失败'))
    return {text:String(payload.text||'').trim(),latencyMs:Date.now()-started}
  }
  if(provider==='elevenlabs') {
    if(!elevenKey) throw missingKey(provider)
    form.append('model_id',process.env.ELEVENLABS_STT_MODEL_ID||'scribe_v1')
    const response=await request('https://api.elevenlabs.io/v1/speech-to-text',{method:'POST',headers:{'xi-api-key':elevenKey},body:form},180000)
    const payload:any=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(jsonError(payload,'ElevenLabs 转写失败'))
    return {text:String(payload.text||'').trim(),latencyMs:Date.now()-started}
  }
  throw new Error(labelFor(provider)+' ASR 适配器当前不可用。')
}

export async function cloneVoiceProfile(buffer: Buffer, mimeType: string, filename: string, name: string): Promise<{id:string;name:string}> {
  if(provider==='local') {
    const makeForm=()=>{const form=new FormData();form.append('name',name);form.append('kind','clone');form.append('language','Auto');form.append('ref_audio',new Blob([buffer],{type:mimeType||'audio/webm'}),filename||'reference.webm');return form}
    let response=await request(localTtsUrl+'/profiles',{method:'POST',body:makeForm()},180000)
    if(response.status===404)response=await request(localTtsUrl+'/api/profiles',{method:'POST',body:makeForm()},180000)
    const payload:any=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(jsonError(payload,'VoiceStudio 音色克隆失败'))
    const p=payload.profile||payload.data||payload
    const id=String(p.id||p.profileId||'')
    if(!id)throw new Error('VoiceStudio 未返回新音色 ID。')
    return {id,name:String(p.name||name)}
  }
  if(provider==='elevenlabs') {
    if(!elevenKey)throw missingKey(provider)
    const form=new FormData();form.append('name',name);form.append('files',new Blob([buffer],{type:mimeType||'audio/webm'}),filename||'reference.webm');form.append('description','User-provided voice sample')
    const response=await request('https://api.elevenlabs.io/v1/voices/add',{method:'POST',headers:{'xi-api-key':elevenKey},body:form},180000)
    const payload:any=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(jsonError(payload,'ElevenLabs 克隆失败'))
    if(!payload.voice_id)throw new Error('ElevenLabs 未返回 voice_id。')
    return {id:String(payload.voice_id),name}
  }
  throw new Error(provider==='openai'?'OpenAI 标准 TTS 仅提供预设音色，不支持任意音色克隆。':labelFor(provider)+' 克隆适配器当前不可用。')
}
