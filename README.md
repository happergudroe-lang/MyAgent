# MyAgent

A multi-provider AI Agent workspace. One chat UI, a unified model gateway, and server-side provider credentials.

## Stack

- React + TypeScript + Vite + Framer Motion
- Express API server
- Server-sent events (SSE) for incremental text generation

## Supported providers

| Provider | Server environment key | Default API base |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| DeepSeek | `DEEPSEEK_API_KEY` | `https://api.deepseek.com` |
| Claude | `ANTHROPIC_API_KEY` | `https://api.anthropic.com` |
| Gemini | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Qwen | `QWEN_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Custom | `CUSTOM_API_KEY` | Set `CUSTOM_BASE_URL` |

The gateway uses OpenAI-compatible Chat Completions for OpenAI, DeepSeek, Gemini, Qwen and custom endpoints. Claude uses the Anthropic Messages API and normalizes its SSE text deltas into the same frontend event format.

## Local setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
```

Add one or more provider keys to the server-side `.env` file. Then run:

```bash
npm run dev
```

Vite normally starts at http://localhost:5173 and proxies `/api` to the Express service on port 3001.

## API endpoints

- `GET /api/health` — server health and configured provider count
- `GET /api/providers` — provider list, available model IDs and configured status
- `POST /api/chat` — streaming chat; request body includes `provider`, `model`, and `messages`

## Security before public deployment

This is a development-stage gateway, not a production multi-user service. Before exposing it publicly, add authentication, per-user encrypted key storage, rate limiting and quotas, origin/CSRF protections, request validation, audit logging with secret redaction, and provider-specific timeout/cancellation handling. Do not commit `.env`.

## Current limitations

Conversation persistence, user accounts, actual tool execution, file processing and production deployment are not implemented yet.
