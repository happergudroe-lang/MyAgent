# MyAgent voice providers and public deployment

The browser never connects directly to a developer's laptop. The authenticated MyAgent API proxies audio to the provider selected by `VOICE_PROVIDER`. All API keys remain server-side.

## Supported provider modes

| `VOICE_PROVIDER` | TTS | ASR | Voice cloning | Required server environment |
| --- | --- | --- | --- | --- |
| `local` | VoiceStudio | VoiceStudio | VoiceStudio profiles | `VOICE_STUDIO_URL`, optional `VOICE_STUDIO_ASR_URL` |
| `openai` | OpenAI Speech API | OpenAI transcription | No | `OPENAI_API_KEY` |
| `elevenlabs` | ElevenLabs | ElevenLabs Scribe | Instant Voice Clone | `ELEVENLABS_API_KEY` |
| `minimax` | MiniMax T2A v2 | Not yet supported | Not yet supported | `MINIMAX_API_KEY`, `MINIMAX_GROUP_ID` |
| `fish` | Fish Audio TTS | Not yet supported | Private voice-model creation | `FISH_AUDIO_API_KEY`, optional `FISH_AUDIO_VOICE_ID` |

Unsupported capabilities return explicit errors and are not silently routed to another provider.

## Fastest public setup: Vercel + OpenAI

This path does not need a GPU, a home PC, a tunnel, or a separate voice server. Vercel calls the cloud Speech API directly.

1. Deploy the MyAgent repository to Vercel and configure the existing `DATABASE_URL` and chat-model environment variables as usual.
2. In **Vercel → Project → Settings → Environment Variables**, set:
   - `VOICE_PROVIDER=openai`
   - `OPENAI_API_KEY` = a server-side OpenAI API key with Audio API access and billing enabled
   - Optional `OPENAI_TTS_MODEL=gpt-4o-mini-tts`
   - Optional `OPENAI_ASR_MODEL=gpt-transcribe`
   - Optional `OPENAI_TTS_INSTRUCTIONS=Speak naturally and conversationally. Use clear, warm, expressive delivery.`
3. Apply the variables to Production (and Preview if desired), then redeploy.
4. Sign in to MyAgent, open Voice, and check that the status reports **OpenAI TTS** and lists the preset voices.

The Speech API currently documents 13 built-in voices. They are presets, not user-created voice clones. The OpenAI provider deliberately reports `cloneSupported: false`; the clone endpoint returns HTTP 409 rather than pretending to clone. OpenAI requires a clear end-user disclosure that generated speech is AI-generated.

**Lifecycle warning:** OpenAI currently marks `gpt-4o-mini-tts` as deprecated with a scheduled shutdown of **2027-01-06**. This adapter uses the Speech API model named by `OPENAI_TTS_MODEL` and must be migrated to the supported Realtime speech workflow before that shutdown. Do not treat this model as a permanent integration.

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

- **Vercel is the control plane, not a GPU host.** It authenticates users and proxies audio. Long audio uploads and responses remain subject to Vercel function duration, body-size, and bandwidth limits. The current browser flow buffers the final audio before playback; it is not a token-by-token realtime audio stream.
- **Concurrency:** cloud vendors enforce account-level RPM/concurrency quotas. Add per-user quotas and queueing before opening the service widely. The existing general chat limiter is not a speech billing quota. A single local GPU host serializes or competes for VRAM across users and can become unavailable under load.
- **Cost:** OpenAI transcription and TTS, ElevenLabs TTS/STT/cloning, and MiniMax TTS are metered by their current account plans and usage dimensions. Set provider spending alerts and per-account limits before sharing the URL. No free or unlimited usage is assumed.
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
VOICE_PROVIDER=local
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
