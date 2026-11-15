# MyAgent

A dark glassmorphism AI-agent workspace built with React, TypeScript, Vite and Framer Motion.

## Quick start

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually http://localhost:5173).

## Current MVP

- Three-column workspace layout
- Agent mode tabs and model selector
- Conversation list, new chat, search and selection
- Interactive tool toggles
- Composer actions and send flow with simulated assistant response
- Motion-based hover, entrance and panel interactions
- Responsive layout for narrower screens

## Next milestones

1. Connect a secure backend and streaming model API.
2. Add persisted conversations and user settings.
3. Implement real tool execution with explicit approval gates.
4. Add authentication, workspace isolation and deployment.

## Security

Do not put provider API keys in frontend source or `VITE_*` variables. Use a server-side API proxy and environment secrets.
