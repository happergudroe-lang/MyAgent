# MyAgent

A multi-provider AI Agent workspace. One chat UI, a unified model gateway, and server-side provider credentials.

## Stack

- React + TypeScript + Vite + Framer Motion
- Express API server
- Server-sent events (SSE) for incremental text generation
- SQLite-backed per-account conversation history and browser-local workspace preferences
- Markdown, GFM tables/lists, and syntax-highlighted code blocks
- Agent role instructions included in model context

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
- `GET /api/tools` — available tools and configuration status
- `POST /api/files` — parse PDF/TXT/MD/CSV/JSON/LOG uploads (8 MB limit)
- `POST /api/approvals/:id` — approve or reject a pending sandbox execution
- `POST /api/chat` — Agent loop with streaming text, tool events and approval requests

## Security baseline

The current app includes bcrypt password hashing, HttpOnly session cookies, per-user conversation scoping, registration/login rate limits, chat IP rate limits, basic security headers, request-size limits and server-side provider secrets. It is suitable for a controlled test deployment after configuring HTTPS and a persistent database disk, but is not a fully hardened production service. Remaining work includes email verification, password reset, per-account quotas, CSRF/origin policy, audit logging, session management, and provider timeout/cancellation handling. Do not commit `.env`.

## Current limitations

Accounts and conversation history are stored in SQLite on the server and can sync across devices when the same account is used. Workspace preferences (selected model, provider, enabled tools and selected Agent) remain browser-local. Uploaded files are parsed in memory and are not persisted. The included Render Blueprint uses a persistent disk for SQLite; the database is not an encrypted application-level vault.


## Built-in Agent tools

The server currently exposes two low-risk tools to compatible models: `calculator` (numeric arithmetic expressions only) and `get_current_time` (IANA timezone-aware time lookup). Tool execution is limited to enabled tools sent by the UI. The server caps each agent turn at five tool rounds. Arbitrary code execution, shell access, filesystem access and unrestricted web browsing are intentionally not exposed.


## Agent tools and integrations

- Calculator and timezone-aware current-time lookup are built in.
- Web search uses Tavily. Set `TAVILY_API_KEY` in the server `.env`; without it the tool returns a clear configuration error.
- PDF, TXT, Markdown, CSV, JSON and LOG uploads are parsed server-side in memory (8 MB maximum) and inserted into the current prompt context. Files are not persisted.
- JavaScript and Python execution is sent to the Piston remote execution service. Every execution requires an explicit browser approval prompt and runs with a short timeout. Do not submit secrets or sensitive code to a third-party execution service.
- Agent tool loops are capped at six rounds. Tools are enabled per request from the workspace toggles.

For web search, add `TAVILY_API_KEY` to `.env`. For file upload and PDF parsing, install dependencies with `npm install` before starting the server.


## Accounts and private workspaces

- Email + password registration and login are available.
- Passwords are hashed with bcrypt (12 rounds); raw passwords are never stored.
- Authentication uses an HttpOnly, SameSite=Lax session cookie with a 7-day expiry. Session tokens are stored as SHA-256 hashes in SQLite.
- SQLite stores users, sessions and conversations. Conversations are scoped by both user ID and conversation ID, so accounts cannot read or overwrite each other's history.
- The database is created automatically at server startup. Set `DATABASE_PATH` to choose its location; back up this file and keep it out of Git.
- Chat, file upload and approval endpoints require authentication. Health, provider metadata and tool metadata remain public.
- Registration validates email, username and password length. Use HTTPS in production and configure secure cookies by setting `NODE_ENV=production`.

## First run

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and configure at least one model API key.
4. Run `npm run dev`, then open `http://localhost:5173`.
5. Register an account from the sign-in screen.

This is still an early deployment baseline. Before exposing it publicly, add distributed per-IP/account rate limiting (the current login/register limiter is in-memory and single-process), email verification, password reset, CSRF/origin protections, backups, monitoring and a managed production database. Do not expose the development server directly to the public internet.


## Public test deployment (Render)

A Render Blueprint is included at `render.yaml`. It builds the Vite frontend and runs the Express API from one origin, with a persistent disk mounted at `/var/data` for SQLite. The persistent disk requires a paid Render web-service plan; do not remove it or use an ephemeral filesystem for user accounts. Render creates a public HTTPS URL after deployment.

1. Push this repository to GitHub (the default branch is `main`).
2. Open [Render Blueprint deployment](https://render.com/blueprint/new) and connect `happergudroe-lang/MyAgent`.
3. Review the `myagent` service and its persistent disk. Select/confirm the Starter plan.
4. Add at least one provider secret (for example `OPENAI_API_KEY`) in Render's environment settings. Never put keys in GitHub or frontend variables.
5. Deploy. Wait for the health check at `/api/health` to pass, then share the generated `https://...` URL with testers.

The public URL is created by Render during deployment; it cannot be pre-generated from this repository. Keep the provider key private: all testers use the configured server-side provider account and may consume its API quota. The included IP-based chat limiter is a basic test safeguard, not a per-user billing/quota system. Use test-only keys and set provider spending limits before inviting friends.

Render persistent disks are single-instance storage. Back up `/var/data/myagent.sqlite` regularly. For larger production deployments, migrate to managed PostgreSQL and add email verification, password reset, per-user quotas, audit logs, and a stronger account-level abuse-prevention system.
