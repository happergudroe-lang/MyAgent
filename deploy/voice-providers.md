# MyAgent voice providers and public deployment

The browser never connects directly to a developer's laptop. The authenticated MyAgent API proxies audio to the provider selected by `VOICE_PROVIDER`. All API keys remain server-side.

## Supported provider modes

| `VOICE_PROVIDER` | TTS | ASR | Voice cloning | Required server environment |
| --- | --- | --- | --- | --- |
| `local` | VoiceStudio | VoiceStudio | VoiceStudio profiles | `VOICE_STUDIO_URL`, optional `VOICE_STUDIO_ASR_URL` |
| `openai` | OpenAI Speech API | OpenAI transcription | No | `OPENAI_API_KEY` |
| `elevenlabs` | ElevenLabs | ElevenLabs Scribe | Instant Voice Clone | `ELEVENLABS_API_KEY` |
| `minimax` | MiniMax T2A v2 | Not yet supported | Not yet supported | `MINIMAX_API_KEY`, `MINIMAX_GROUP_ID` |
| `fish` | Not yet supported | Not yet supported | Not yet supported | Reserved adapter slot; currently reports unavailable |

Unsupported capabilities return explicit errors and are not silently routed to another provider.

## Fastest public setup: Vercel + OpenAI

This path does not need a GPU, a home PC, a tunnel, or a separate voice server. Vercel calls the cloud Speech API directly.

1. Deploy the MyAgent repository to Vercel and configure the existing `DATABASE_URL` and chat-model environment variables as usual.
2. In **Vercel → Project → Settings → Environment Variables**, set:
   - `VOICE_PROVIDER=openai`
   - `OPENAI_API_KEY` = a server-side OpenAI API key with Audio API access and billing enabled
   - Optional `OPENAI_TTS_MODEL=gpt-4o-mini-tts`
   - Optional `OPENAI_ASR_MODEL=gpt-4o-mini-transcribe`
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

## MiniMax TTS

Set `VOICE_PROVIDER=minimax`, `MINIMAX_API_KEY`, and the account's `MINIMAX_GROUP_ID`. The current adapter calls the synchronous T2A v2 endpoint and exposes the documented preset voice IDs. ASR and cloning are not implemented in this adapter yet, so the UI disables recording and cloning rather than showing a false full-duplex experience. A future adapter can add the provider's rapid voice cloning and transcription APIs without changing the public MyAgent route contract.

## Local VoiceStudio on a separate GPU host

Use this when you want to keep OmniVoice/VoiceStudio cloning and inference. The GPU machine must stay powered on and expose a stable HTTPS URL reachable by the MyAgent server.

1. Run VoiceStudio on the GPU host with its TTS service listening on port 3900 and ASR on 3901.
2. Put a TLS reverse proxy (Caddy, Nginx, or a managed HTTPS tunnel) in front of those services. Do not expose raw development ports directly to the public internet.
3. Restrict the upstream to MyAgent where possible (firewall allow-list, private network, or proxy authentication). If the VoiceStudio service itself has no authentication, do not expose it as an unrestricted public endpoint.
4. Set the Vercel server environment:
   - `VOICE_PROVIDER=local`
   - `VOICE_STUDIO_URL=https://voice.example.com`
   - `VOICE_STUDIO_ASR_URL=https://asr.example.com`
5. Redeploy MyAgent and verify `GET /api/voice/status` while signed in.

The URL must be reachable **from Vercel's server runtime**, not merely from your browser. A `127.0.0.1` URL points to the Vercel function container and will not reach the home PC. A home-PC tunnel still depends on that PC's uptime, network, GPU memory, and upload bandwidth; it is not a high-availability service.

## Capacity, latency, cost, and privacy

- **Vercel is the control plane, not a GPU host.** It authenticates users and proxies audio. Long audio uploads and responses remain subject to Vercel function duration, body-size, and bandwidth limits. The current browser flow buffers the final audio before playback; it is not a token-by-token realtime audio stream.
- **Concurrency:** cloud vendors enforce account-level RPM/concurrency quotas. Add per-user quotas and queueing before opening the service widely. The existing general chat limiter is not a speech billing quota. A single local GPU host serializes or competes for VRAM across users and can become unavailable under load.
- **Cost:** OpenAI transcription and TTS, ElevenLabs TTS/STT/cloning, and MiniMax TTS are metered by their current account plans and usage dimensions. Set provider spending alerts and per-account limits before sharing the URL. No free or unlimited usage is assumed.
- **Privacy:** recordings and text are sent to the selected provider. Review its data retention, training, regional processing, and voice-cloning consent terms. Never upload another person's voice without authorization. API keys must only be configured as server-side environment variables, never `VITE_*`, browser storage, or committed files.
- **AI disclosure:** tell users that generated audio is AI-generated. A voice clone should not be represented as the real speaker speaking live.
- **No-key/no-GPU reality:** without a cloud API key, OpenAI/ElevenLabs/MiniMax cloud modes cannot authenticate; without a reachable GPU host, local mode cannot synthesize or transcribe. The app reports unavailable and does not silently play browser speech as a fallback.

## Environment variable reference

```dotenv
VOICE_PROVIDER=local
VOICE_STUDIO_URL=http://127.0.0.1:3900
VOICE_STUDIO_ASR_URL=http://127.0.0.1:3901
OPENAI_API_KEY=
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_ASR_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_INSTRUCTIONS=Speak naturally and conversationally.
ELEVENLABS_API_KEY=
ELEVENLABS_MODEL_ID=eleven_multilingual_v2
ELEVENLABS_STT_MODEL_ID=scribe_v1
MINIMAX_API_KEY=
MINIMAX_GROUP_ID=
MINIMAX_TTS_MODEL=speech-2.8-turbo
FISH_AUDIO_API_KEY=
```
