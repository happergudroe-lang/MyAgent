# MyAgent

A personal AI-agent workspace with a dark glassmorphism interface, React + TypeScript + Vite frontend, and a small server-side streaming API proxy.

## Requirements

- Node.js 20 or newer
- An API key from a provider that supports the OpenAI-compatible Chat Completions streaming format

## Run locally

```bash
npm install
cp .env.example .env
```

Open `.env` and set your provider key and model:

```env
AI_API_KEY=your_secret_key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
PORT=3001
```

Then start both the frontend and API server:

```bash
npm run dev
```

Vite runs the web app on its local development URL (normally http://localhost:5173) and proxies `/api` requests to the local Express server.

## Provider compatibility

The server sends a streaming request to `{AI_BASE_URL}/chat/completions` using server-sent events. The UI incrementally renders `choices[0].delta.content` chunks. OpenAI documents this streaming format in its [streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses).

For compatible providers, set `AI_BASE_URL` to the provider's API base URL and `AI_MODEL` to a model available to your account.

## Security notes

- Keep the real `AI_API_KEY` only in the server-side `.env` file.
- Never add secrets to frontend source, `VITE_*` variables, or Git commits.
- The `.env` file is ignored by Git.
- This is an early development server. Before public deployment, add authentication, rate limiting, request quotas, origin/CSRF protections, robust validation, and server-side logging/redaction.

## Current features

- Three-column responsive workspace and glassmorphism UI
- Agent tabs, conversation list, search and new chat
- Model selector and tool toggles (visual settings at this stage)
- Streaming assistant responses through the server proxy
- API health endpoint: `GET /api/health`

## Not implemented yet

Persistent conversation storage, authentication, real tool execution, file upload processing, and production deployment.
