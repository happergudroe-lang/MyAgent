import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, RefreshCw } from 'lucide-react'

export const DEFAULT_CANVAS_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#0f1115;color:#e8eaed}main{text-align:center;padding:32px}h1{font-size:26px;margin:0 0 12px}code{background:#1c1f26;padding:2px 6px;border-radius:6px}</style></head><body><main><h1>HTML 画布</h1><p>把 AI 生成的 HTML 粘贴到「代码」页，预览会实时刷新。</p><p>支持 <code>&lt;style&gt;</code> 与 <code>&lt;script&gt;</code>，运行在沙箱 iframe 中。</p></main></body></html>`
export function normalizeCanvasHtml(src:string){const t=(src||'').trim();if(!t)return DEFAULT_CANVAS_HTML;if(/<html[\\s>]/i.test(t)||/<!doctype/i.test(t))return t;return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#fff;color:#111;line-height:1.7}</style></head><body>'+t+'</body></html>'}
export function CanvasPane({html,onChange}:{html:string;onChange:(value:string)=>void}){
 const [tab,setTab]=useState<'preview'|'code'>('preview')
 const [draft,setDraft]=useState(()=>html||DEFAULT_CANVAS_HTML)
 const [nonce,setNonce]=useState(0)
 useEffect(()=>{if(html)setDraft(html)},[html])
 useEffect(()=>{const t=window.setTimeout(()=>setNonce(v=>v+1),350);return()=>window.clearTimeout(t)},[draft])
 const doc=useMemo(()=>normalizeCanvasHtml(draft),[draft,nonce])
 const download=()=>{try{const blob=new Blob([doc],{type:'text/html'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='canvas.html';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1500)}catch{}}
 return <div className="canvas-pane">
  <div className="canvas-toolbar">
   <div className="canvas-tabs" role="tablist"><button role="tab" aria-selected={tab==='preview'} className={tab==='preview'?'active':''} onClick={()=>setTab('preview')}>预览</button><button role="tab" aria-selected={tab==='code'} className={tab==='code'?'active':''} onClick={()=>setTab('code')}>代码</button></div>
   <div className="canvas-actions"><button title="刷新预览" aria-label="刷新预览" onClick={()=>setNonce(v=>v+1)}><RefreshCw size={14}/></button><button title="复制 HTML" aria-label="复制 HTML" onClick={()=>void navigator.clipboard.writeText(draft).catch(()=>{})}><Copy size={14}/></button><button title="下载 HTML" aria-label="下载 HTML" onClick={download}><Download size={14}/></button></div>
  </div>
  {tab==='preview'?<div className="canvas-preview"><iframe title="HTML 画布预览" sandbox="allow-scripts allow-forms allow-modals allow-downloads" referrerPolicy="no-referrer" srcDoc={doc}/></div>:<textarea aria-label="HTML 源码" className="canvas-code" value={draft} onChange={e=>{setDraft(e.target.value);onChange(e.target.value)}} spellCheck={false} placeholder="在这里粘贴 HTML 代码…"/>}
 </div>
}
