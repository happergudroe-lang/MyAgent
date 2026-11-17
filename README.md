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


## Oracle Cloud Always Free deployment

An Ubuntu ARM64 deployment path is provided for OCI Ampere A1 Always Free resources. See [deploy/README-oracle.md](deploy/README-oracle.md) for the full console walkthrough, network rules, HTTPS setup, updates and SQLite backup guidance.

Quick start on a fresh Ubuntu ARM64 VM:

```bash
git clone https://github.com/happergudroe-lang/MyAgent.git
cd MyAgent
sudo bash deploy/oracle-cloud-setup.sh
```

The bootstrap installs Node.js 22 and Nginx, builds the app, configures a systemd service and stores SQLite in `/var/lib/myagent`. Add provider credentials to `/etc/myagent/myagent.env` and restart with `sudo systemctl restart myagent`. Configure OCI ingress and HTTPS before public testing. Only provision resources labeled **Always Free Eligible**; Oracle may reclaim qualifying idle Always Free compute, and capacity is not guaranteed.


## Vercel + Supabase deployment (recommended)

MyAgent can be deployed with a Vercel Hobby project and a Supabase Free database. The Vercel project serves the Vite frontend and runs the Express API as a serverless function. User accounts, sessions and chat history are stored in Supabase PostgreSQL.

### 1. Create the Supabase database

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor** in the project dashboard.
3. Paste and run the contents of [supabase/schema.sql](supabase/schema.sql).
4. Open **Project Settings → Database → Connection string → Session pooler**.
5. Copy the PostgreSQL connection URI. Use the pooler URL (usually port 6543), not a client-side/public URL.

### 2. Configure Vercel

1. Import `happergudroe-lang/MyAgent` from GitHub at https://vercel.com/new.
2. Keep the project root as `./`. The repository's `vercel.json` configures the Vite build and API function.
3. Add these Environment Variables in Vercel Project Settings → Environment Variables:
   - `DATABASE_URL`: the Supabase Session Pooler connection URI.
   - At least one model key, for example `OPENAI_API_KEY` or `DEEPSEEK_API_KEY`.
   - Optional: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `QWEN_API_KEY`, `CUSTOM_API_KEY`, `CUSTOM_BASE_URL`, `CUSTOM_MODELS`, `TAVILY_API_KEY`.
4. Deploy. Vercel assigns the public HTTPS URL after the deployment succeeds.

Do not add database credentials or model keys to variables prefixed with `VITE_`; those would be exposed to browsers. Never commit real credentials to GitHub.

### Runtime notes and limitations

- The API uses the Supabase PostgreSQL connection pooler through the server-only `DATABASE_URL`.
- The SQL schema enables Row Level Security and intentionally defines no public policies. The app accesses tables only through its server-side database connection.
- Passwords are bcrypt-hashed; session tokens are stored as SHA-256 hashes; chat records are scoped by user ID.
- The Piston code-execution approval tool is disabled on Vercel because in-memory approval state is not reliable across separate serverless invocations. It remains available in the traditional long-running Node server mode.
- Vercel Hobby function duration and usage limits apply. Long-running model responses may time out; test the selected provider and model before inviting others.
- Supabase Free projects can pause after inactivity and have plan-specific storage/compute limits. Export or back up important data regularly.
- The Vercel Hobby plan is intended for personal, non-commercial use. Check current provider terms and quotas before public or commercial use.
- Local development also requires `DATABASE_URL` in a local `.env` file. Start with `npm run dev`.

## WeCom @Agent gateway (initial integration)

The Express server exposes an encrypted callback at `/wecom/callback`. Configure a WeCom self-built application and set the server-only variables below. Do not commit real values.

- `WECOM_CORP_ID`: enterprise CorpID
- `WECOM_AGENT_ID`: application AgentId
- `WECOM_SECRET`: application Secret (reserved for the outbound application-message API integration)
- `WECOM_TOKEN`: callback Token
- `WECOM_AES_KEY`: callback EncodingAESKey (43 characters, without the trailing equals sign)
- `WECOM_DEFAULT_PROVIDER`: fallback provider, defaults to `my`

Callback URL: `https://YOUR_PUBLIC_HOST/wecom/callback`.

The initial gateway validates plaintext or AES-encrypted callbacks, parses text messages addressed as `@GPT ...`, `@Claude ...`, `@Gemini ...`, `@DeepSeek ...`, `@本机 ...` or `/agent GPT ...`, maps sender/group sessions in PostgreSQL, and records audit entries. The current first phase uses passive text replies. It does **not** yet implement WeCom outbound API push, file transfer, general tool execution, durable approval workers, or the Channels/Agent/Audit console UI; approval records are persisted but approval does not execute external side effects. Do not configure production workflows that depend on those unfinished capabilities.

WeCom callback status: `GET /api/wecom/status`. It reports configuration presence and session-binding count only; it does not expose secrets. For a real group session, the callback payload's `ChatId` is used when present; otherwise the sender ID scopes the conversation.

The callback should be reachable over public HTTPS. A local development server can be exposed with Tailscale Funnel, but the Funnel hostname must be configured as the callback URL and the process must remain running.
