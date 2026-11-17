import { EdgeTTS } from 'node-edge-tts'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const cases = [
  { voice: 'zh-CN-XiaoxiaoNeural', lang: 'zh-CN', text: '你好，我是 MyAgent。今天很高兴和你聊天。' },
  { voice: 'zh-CN-XiaoyiNeural', lang: 'zh-CN', text: '你好，欢迎使用 MyAgent。我们现在测试中文神经语音。' },
  { voice: 'zh-CN-YunxiNeural', lang: 'zh-CN', text: '你好，我是云希。欢迎体验 MyAgent 的语音对话。' },
  { voice: 'zh-CN-YunjianNeural', lang: 'zh-CN', text: '你好，我是云健。现在进行 Edge 中文语音测试。' },
  { voice: 'en-US-AriaNeural', lang: 'en-US', text: 'Hello, this is MyAgent. This is a live test of Microsoft Edge neural speech.' },
  { voice: 'en-US-GuyNeural', lang: 'en-US', text: 'Hello, I am Guy. Welcome to the MyAgent voice experience.' },
]

await mkdir('artifacts/edge-tts-smoke', { recursive: true })
const report = []
for (const item of cases) {
  const tts = new EdgeTTS({ voice: item.voice, lang: item.lang, outputFormat: 'audio-24khz-96kbitrate-mono-mp3', timeout: 45000 })
  const started = performance.now()
  let firstChunkMs = null
  const chunks = []
  for await (const chunk of tts.streamAudio(item.text)) {
    if (!Buffer.isBuffer(chunk)) continue
    if (firstChunkMs === null) firstChunkMs = Math.round(performance.now() - started)
    chunks.push(chunk)
  }
  const totalMs = Math.round(performance.now() - started)
  const audio = Buffer.concat(chunks)
  if (!audio.length || firstChunkMs === null) throw new Error(item.voice + ': Edge TTS returned no MP3 audio')
  const path = 'artifacts/edge-tts-smoke/' + item.voice + '.mp3'
  await writeFile(path, audio)
  const durationSeconds = Number(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path], { encoding:'utf8' }).trim())
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error(item.voice + ': MP3 duration could not be measured')
  report.push({ voice:item.voice, firstChunkLatencyMs:firstChunkMs, totalSynthesisMs:totalMs, audioDurationSeconds:Number(durationSeconds.toFixed(2)), audioBytes:audio.length })
  console.log(JSON.stringify(report[report.length - 1]))
}
await writeFile('artifacts/edge-tts-smoke/report.json', JSON.stringify({ testedAt:new Date().toISOString(), provider:'Microsoft Edge Read Aloud (no API key)', results:report }, null, 2))
console.log('Edge TTS smoke test passed for ' + report.length + ' voices.')
