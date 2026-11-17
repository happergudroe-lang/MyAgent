# MyAgent voice providers and public deployment

The browser never connects directly to a developer's laptop. The authenticated MyAgent API proxies audio to the provider selected by `VOICE_PROVIDER`. All API keys remain server-side.

## Supported provider modes

| `VOICE_PROVIDER` | TTS | ASR | Voice cloning | Required server environment |
| --- | --- | --- | --- | --- |
| `edge` | Microsoft Edge neural TTS | Browser Web Speech API (when supported) | No | No API key |
| `local` | VoiceStudio | VoiceStudio | VoiceStudio profiles | `VOICE_STUDIO_URL`, optional `VOICE_STUDIO_ASR_URL` |
| `openai` | OpenAI Speech API | OpenAI transcription | No | `OPENAI_API_KEY` |
| `elevenlabs` | ElevenLabs | ElevenLabs Scribe | Instant Voice Clone | `ELEVENLABS_API_KEY` |
| `minimax` | MiniMax T2A v2 | Not yet supported | Not yet supported | `MINIMAX_API_KEY`, `MINIMAX_GROUP_ID` |
| `fish` | Fish Audio TTS | Not yet supported | Private voice-model creation | `FISH_AUDIO_API_KEY`, optional `FISH_AUDIO_VOICE_ID` |

Unsupported capabilities return explicit errors and are not silently routed to another provider.

## Zero-cost public setup: Vercel + Microsoft Edge neural TTS

This is the default public speech path. It uses the unofficial Edge Read Aloud WebSocket protocol through the MIT-licensed `node-edge-tts` Node client. It needs **no OpenAI key, no paid speech API, no GPU, and no separate voice server**. The existing MYRQVIA chat provider remains responsible for LLM answers; this provider only synthesizes speech.

1. Deploy MyAgent to Vercel. Keep the existing `DATABASE_URL` and your already-configured MYRQVIA/local/free chat environment intact.
2. In **Vercel → Project → Settings → Environment Variables**, set `VOICE_PROVIDER=edge` for Production (and Preview if desired). Remove any old `VOICE_PROVIDER=local` or paid-provider override. No `OPENAI_API_KEY`, ElevenLabs, MiniMax, or Fish Audio key is required for this mode.
3. Redeploy. The `/api/voice/status` route performs a real short Edge TTS synthesis probe (cached briefly per warm function instance); it reports unavailable if Microsoft rejects the WebSocket or returns no audio.

**LLM availability is separate:** Edge TTS no longer needs the GPU PC, but MyAgent chat still uses the existing `MYRQVIA` endpoint configured by `MY_BASE_URL`. If that endpoint is tunneled from the user's home PC, the PC must remain online for fresh LLM answers. The Edge voice audition and TTS endpoint can work independently of that LLM host when supplied text.
4. Sign in, open Voice, and choose one of the Edge presets. TTS returns MP3 through `/api/voice/tts`. The UI labels Edge voices as presets and disables cloning.
5. Microphone input uses the browser Web Speech API on supported browsers (typically current Chrome/Edge). This recognition is browser-managed and may use the browser vendor's online speech service; it is not an offline ASR engine and its availability/privacy behavior is controlled by the browser. If unsupported, the app explains why recording is unavailable. VoiceStudio local ASR remains available by selecting `VOICE_PROVIDER=local` on a host where it is reachable.

### Edge voice catalog

The initial allow-list includes `zh-CN-XiaoxiaoNeural`, `zh-CN-XiaoyiNeural`, `zh-CN-YunxiNeural`, `zh-CN-YunjianNeural`, `en-US-AriaNeural`, and `en-US-GuyNeural`. The CI smoke test actually requests all six voices, measures first-audio-chunk latency and full MP3 duration, and uploads the MP3s plus JSON report as a GitHub Actions artifact.

**Live CI verification (GitHub-hosted Ubuntu runner, 2026-11-17; three real MP3 syntheses):**

| Voice | First audio chunk | Full synthesis | MP3 duration | MP3 size |
| --- | ---: | ---: | ---: | ---: |
| `zh-CN-XiaoxiaoNeural` | 295 ms | 500 ms | 4.68 s | 56,160 bytes |
| `zh-CN-XiaoyiNeural` | 226 ms | 575 ms | 6.10 s | 73,152 bytes |
| `zh-CN-YunxiNeural` | 331 ms | 712 ms | 5.28 s | 63,360 bytes |
| `zh-CN-YunjianNeural` | 500 ms | 836 ms | 5.28 s | 63,360 bytes |
| `en-US-AriaNeural` | 364 ms | 503 ms | 6.55 s | 78,624 bytes |
| `en-US-GuyNeural` | 316 ms | 621 ms | 5.45 s | 65,376 bytes |

All six live syntheses passed. The job uploaded all six MP3 files plus `report.json`: [download test artifact](https://github.com/happergudroe-lang/MyAgent/actions/runs/44105086917/artifacts/14338052040). These are CI-runner measurements, not a promise of the same latency from every region or browser.

**Important limits:** these are Microsoft Edge Read Aloud neural presets, **not GPT voices and not cloned voices**. Clone is explicitly unsupported. This is a no-API-key/no-metered-speech-bill path, but do not promise literally unlimited use: Microsoft can throttle, change, or block this unofficial endpoint and provides no SLA or guaranteed quota. Voice availability, latency, and quality can change without notice. The browser ASR path may also send microphone audio to the browser's speech-recognition provider; disclose this to users.

### Vercel Hobby feasibility and limits

The app uses the Node.js runtime, where `node-edge-tts` opens an outbound WebSocket to Microsoft and collects the MP3 response. Vercel Hobby is free only within its included quotas; this design does not guarantee unlimited free Vercel execution or unlimited Microsoft usage. Stay on Hobby and do not upgrade for this path. The existing Vercel function config sets `maxDuration: 60`; the request is one-shot MP3, not a persistent browser WebSocket session. Hobby limits, response/request body caps, deployment/build quotas, and Microsoft endpoint reachability still apply. If the Edge handshake or generation exceeds the function limit, the API returns an explicit error; it never falls back to a fake browser voice. Vercel Hobby's documented maximum duration depends on Fluid Compute being enabled; check the project's actual setting and logs. The current MP3 response is buffered before browser playback, so this is not GPT-style low-latency duplex audio.

### No-cost fallback if Vercel cannot deploy or reach Microsoft

Run the existing Node server on a computer that remains online, set `VOICE_PROVIDER=edge`, and expose the MyAgent server through the already-used HTTPS tunnel. No GPU is needed for Edge TTS. This avoids Vercel function restrictions but **depends on that host staying powered on, connected, and running the process**; concurrency is limited by the host's CPU/network and Microsoft's service throttling. It is not an always-on cloud service. For local cloning/ASR instead, switch to `VOICE_PROVIDER=local` and keep VoiceStudio running on the GPU host.

## Cloud cloning: ElevenLabs

1. Create an ElevenLabs API key with access to voices, text-to-speech, speech-to-text, and voice creation.
2. Set `VOICE_PROVIDER=elevenlabs` and `ELEVENLABS_API_KEY` in the MyAgent server environment.
3. Optional model variables:
   - `ELEVENLABS_MODEL_ID=eleven_multilingual_v2`
   - `ELEVENLABS_STT_MODEL_ID=scribe_v1`
4. Redeploy MyAgent. Status fetches the account's available voices. Cloned voices are labeled as profiles; built-in voices are labeled as presets.
5. The clone upload endpoint sends the user-provided recording to ElevenLabs. Obtain the speaker's explicit consent and only upload audio you have the right to clone.

ElevenLabs account tier, verification, usage quota, and regional availability can affect voice-library and cloning access. A configured key is not a promise of unlimited concurrency.

## Fish Audio TTS and private voice models\n\nSet `VOICE_PROVIDER=fish` and `FISH_AUDIO_API_KEY`. MyAgent loads private voice models from the Fish Audio account, supports creating a private TTS model from an uploaded recording, and synthesizes through the Fish Audio TTS API. Optionally set `FISH_AUDIO_VOICE_ID` as a preset/default model ID. Fish Audio ASR is not wired into this adapter yet; recording is therefore disabled in this mode, while TTS and voice creation remain available.\n\n## MiniMax TTS

Set `VOICE_PROVIDER=minimax`, `MINIMAX_API_KEY`, and the account's `MINIMAX_GROUP_ID`. The current adapter calls the synchronous T2A v2 endpoint and exposes the documented preset voice IDs. ASR and cloning are not implemented in this adapter yet, so the UI disables recording and cloning rather than showing a false full-duplex experience. A future adapter can add the provider's rapid voice cloning and transcription APIs without changing the public MyAgent route contract.

## Local VoiceStudio on a separate GPU host

Use this when you want to keep OmniVoice/VoiceStudio cloning and inference. The GPU machine must stay powered on and expose stable HTTPS endpoints reachable by the MyAgent server.

1. Run VoiceStudio on the GPU host with its TTS service listening on port 3900 and ASR on 3901. Bind the model services to `127.0.0.1` so they are not directly exposed.
2. Install Nginx and Certbot, create DNS records for `tts.voice.example.com` and `asr.voice.example.com`, and create a Basic Auth user:
   ```bash
   sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx apache2-utils
   sudo htpasswd -c /etc/nginx/.htpasswd myagent
   ```
   Choose a strong password when prompted. Save the following as `/etc/nginx/sites-available/myagent-voice` (replace the hostnames):
   ```nginx
   server {
     listen 80;
     server_name tts.voice.example.com;
     location / {
       auth_basic "MyAgent voice gateway";
       auth_basic_user_file /etc/nginx/.htpasswd;
       proxy_pass http://127.0.0.1:3900;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_read_timeout 180s;
     }
   }
   server {
     listen 80;
     server_name asr.voice.example.com;
     location / {
       auth_basic "MyAgent voice gateway";
       auth_basic_user_file /etc/nginx/.htpasswd;
       proxy_pass http://127.0.0.1:3901;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_read_timeout 180s;
     }
   }
   ```
   Enable the site and issue certificates:
   ```bash
   sudo ln -s /etc/nginx/sites-available/myagent-voice /etc/nginx/sites-enabled/myagent-voice
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d tts.voice.example.com -d asr.voice.example.com
   ```
3. Set the Vercel server environment:
   - `VOICE_PROVIDER=local`
   - `VOICE_STUDIO_URL=https://tts.voice.example.com`
   - `VOICE_STUDIO_ASR_URL=https://asr.voice.example.com`
   - `VOICE_STUDIO_BASIC_AUTH=myagent:THE_PASSWORD_YOU_CHOSE` (server-side only; the adapter adds the Basic Auth header)
4. Redeploy MyAgent and verify `GET /api/voice/status` while signed in.

The URL must be reachable **from Vercel's server runtime**, not merely from your browser. A `127.0.0.1` URL points to the Vercel function container and will not reach the home PC. A home-PC tunnel still depends on that PC's uptime, network, GPU memory, and upload bandwidth; it is not a high-availability service.

## Capacity, latency, cost, and privacy

- **Vercel is the control plane, not a GPU host.** It authenticates users and proxies audio. Long audio uploads and responses remain subject to Vercel function duration, body-size, and bandwidth limits. The current browser flow buffers the final audio before playback; it is not a token-by-token realtime audio stream. The UI's TTS timing is full synthesis response time, not first-chunk time; CI separately measures first-chunk latency.
- **Concurrency and abuse control:** MyAgent currently applies an IP-based limit of 20 TTS/ASR requests per minute and 3 clone uploads per hour. This is a basic guardrail, not a per-account quota or distributed queue; behind proxies, configure Express trusted-proxy handling carefully and add a shared Redis-backed per-user budget before a large public launch. Cloud vendors also enforce account-level RPM/concurrency quotas. A single local GPU host serializes or competes for VRAM across users and can become unavailable under load.
- **Cost:** `edge` has no API key and no per-character API billing from MyAgent; it relies on Microsoft's consumer Edge Read Aloud endpoint, which has no published SLA or guaranteed unlimited quota and may be throttled or withdrawn. Browser Web Speech recognition may send audio to the browser vendor's service. OpenAI, ElevenLabs, and MiniMax remain optional paid adapters only; do not enable them for the zero-cost setup.
- **Privacy:** recordings and text are sent to the selected provider. Review its data retention, training, regional processing, and voice-cloning consent terms. Never upload another person's voice without authorization. API keys must only be configured as server-side environment variables, never `VITE_*`, browser storage, or committed files.
- **AI disclosure:** tell users that generated audio is AI-generated. A voice clone should not be represented as the real speaker speaking live.
- **No-key/no-GPU reality:** without a cloud API key, OpenAI/ElevenLabs/MiniMax cloud modes cannot authenticate; without a reachable GPU host, local mode cannot synthesize or transcribe. The app reports unavailable and does not silently play browser speech as a fallback.

### Indicative provider pricing (checked 2026-11-17)

These are published list-price snapshots, not a bill estimate; region, plan, model, volume discounts, taxes, and future price changes may alter the total.

| Provider / configured model | Published usage price | Notes |
| --- | --- | --- |
| OpenAI `gpt-4o-mini-tts` | $0.60 / 1M input text tokens + $12 / 1M output audio tokens | Token-based; exact cost depends on spoken length and audio tokenization. This model is deprecated and scheduled to shut down 2027-01-06. |
| OpenAI `gpt-transcribe` | about $0.0045 / audio minute | ASR only; chat model charges are separate. |
| ElevenLabs Multilingual v2 | about $0.10 / 1K characters | Voice cloning entitlement and monthly credit bundle depend on subscription tier. |
| MiniMax `speech-2.8-turbo` | about $60 / 1M characters | Rapid voice cloning listed at about $1.50 per voice; not implemented in this adapter. |
| Fish Audio | Account/model and model-tier dependent | Check the live API pricing and plan quota; the free developer model may have different latency and processing guarantees. |

Official price references: [OpenAI audio model and pricing](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts), [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), [ElevenLabs API pricing](https://elevenlabs.io/pricing/api), [MiniMax token plan](https://platform.minimax.io/subscribe/token-plan?tab=api-enterprise), and [Fish Audio API docs](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech).

## Environment variable reference

```dotenv
VOICE_PROVIDER=edge
VOICE_STUDIO_URL=http://127.0.0.1:3900
VOICE_STUDIO_ASR_URL=http://127.0.0.1:3901\nVOICE_STUDIO_BASIC_AUTH=
OPENAI_API_KEY=
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_ASR_MODEL=gpt-transcribe
OPENAI_TTS_INSTRUCTIONS=Speak naturally and conversationally.
ELEVENLABS_API_KEY=
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_STT_MODEL_ID=scribe_v1
MINIMAX_API_KEY=
MINIMAX_GROUP_ID=
MINIMAX_TTS_MODEL=speech-2.8-turbo
FISH_AUDIO_API_KEY=
```
