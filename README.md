# OpenCI ChatAI

Developer-focused README for the current system.

This project is a TypeScript + Express chatbot platform with:
- Anonymous and authenticated chat flows
- Lark OAuth login (JWT cookie session)
- PostgreSQL-first persistence with in-memory fallback
- Optional vector retrieval (pgvector) and optional OpenCI API integration
- Frontend rate-limit + CAPTCHA UX

## Start Here (5 Minutes)

1. Install dependencies.

```bash
npm install
```

2. Configure environment variables in `.env`.

3. Run in development mode.

```bash
npm run dev
```

4. Open `http://localhost:3000`.

## Runtime Requirement

- Production and deployment checks are pinned to Node.js `20.x`.
- Run `node -v` and confirm it starts with `v20` before running deployment gates.
- Local version files `.nvmrc` and `.node-version` are set to `20`.

## Runtime Modes

### Minimum mode (works fastest)
- Set `GROQ_API_KEY`.
- If PostgreSQL is unavailable, app runs with in-memory store.
- Anonymous and authenticated routes still run, but data in in-memory mode is not durable.

### Full mode (recommended)
- PostgreSQL available
- `vector` extension available for semantic retrieval
- Optional OpenCI API credentials configured

## Architecture Overview

### Backend entry point
- App bootstrap, middleware chain, static hosting, route mounting:
  [src/index.ts](src/index.ts)

### Key modules
- Auth and session: [src/auth.ts](src/auth.ts)
- Chat and user endpoints: [src/routes.ts](src/routes.ts)
- DB and fallback storage: [src/database.ts](src/database.ts)
- Chat-specific limiter: [src/rate-limiter.ts](src/rate-limiter.ts)
- AI orchestration: [src/ai-service.ts](src/ai-service.ts)
- Knowledge base prompts: [src/openci-kb.ts](src/openci-kb.ts)
- Vector store (optional): [src/vector-store.ts](src/vector-store.ts)
- OpenCI API client (optional): [src/openci-api.ts](src/openci-api.ts)
- Frontend app: [public/index.html](public/index.html), [public/script.js](public/script.js), [public/styles.css](public/styles.css)

## Core Flows

### Anonymous flow
1. Browser starts without auth token.
2. Server assigns `anon_id` cookie if missing.
3. Anonymous messages use `POST /api/chat/anonymous`.
4. No conversation persistence in DB; history is frontend-managed.
5. Limiter key order: `anon:<anon_id>` then IP fallback if cookie unavailable.

### Authenticated flow
1. User logs in via Lark OAuth.
2. Server sets `auth_token` JWT cookie.
3. Protected routes require auth middleware.
4. Conversations and messages are persisted.
5. Limiter key uses `user:<userId>`.

## Data Model

Primary schema is created in [src/database.ts](src/database.ts):
- `users`
- `conversations`
- `messages`

If PostgreSQL is unavailable, the app falls back to an in-memory store.

## Rate Limiting and Abuse Controls

### Global/API limits
- Global and API rate limits are configured in [src/index.ts](src/index.ts).

### Chat limiter (important)
- Config and key selection in [src/rate-limiter.ts](src/rate-limiter.ts).
- Key strategy:
  - authenticated: `user:<userId>`
  - anonymous normal: `anon:<anon_id>`
  - fallback: `ip:<ip>`
- Server responses include `requiresCaptcha` on limit events.

### Frontend limiter/CAPTCHA
- Client-side pause/countdown/CAPTCHA logic in [public/script.js](public/script.js).

## AI Behavior Layers

Implemented in [src/ai-service.ts](src/ai-service.ts):
- Base prompt + concern extraction
- Tiered KB by auth state (`OPENCI_ANONYMOUS_KB` vs authenticated KB)
- Optional vector retrieval context
- Optional live OpenCI API context for authenticated users

## Environment Variables

Common values in `.env`:
- `PORT`, `NODE_ENV`
- `GROQ_API_KEY`
- `JWT_SECRET`
- `LARK_APP_ID`, `LARK_APP_SECRET`
- `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`
- `TRUST_PROXY` (recommended for proxy deployments)
- Optional: OpenCI API and CORS-related variables

## API Surface (high level)

### Auth
- `GET /api/auth/lark`
- `GET /api/auth/lark/callback`
- `GET /api/auth/me`
- `POST /api/auth/set-role`
- `POST /api/auth/logout`

### Chat and conversations
- `POST /api/chat/anonymous`
- `POST /api/conversations`
- `GET /api/conversations`
- `GET /api/conversations/:conversationId`
- `POST /api/conversations/:conversationId/messages`
- `PATCH /api/conversations/:conversationId`
- `DELETE /api/conversations/:conversationId`

### Health and demo
- `GET /api/health`
- `/api/demo/*` endpoints for diagnostics and feature tests

## Validation and QA

Post-implementation validation report:
- [POST_IMPLEMENTATION_VALIDATION_REPORT.md](POST_IMPLEMENTATION_VALIDATION_REPORT.md)

## Deployment Gates

Use these commands before releasing.

### Flexible gate (current default)
- Local command: `npm run deploy:check:allow-empty-tests`
- CI workflow: `.github/workflows/deploy-check.yml`

### Strict gate (fails when tests are missing)
- Local command: `npm run deploy:check`
- CI workflow: `.github/workflows/deploy-check-strict.yml` (manual trigger)

### Post-start smoke check
- Local command: `npm run smoke:deploy`
- Verifies preflight conditions and `GET /api/health`

## Troubleshooting

### App starts but PostgreSQL errors appear
- In-memory fallback may be active.
- Check DB connection settings in `.env`.

### Vector store initialization fails
- Ensure PostgreSQL `vector` extension is installed.

### Lark login fails
- Verify app credentials and callback URL setup.

### Frequent 400 JSON parse errors while testing
- Usually malformed terminal JSON payload escaping, not backend route failure.

## Maintainer Notes

When modifying behavior, check these files first:
- Middleware and route order: [src/index.ts](src/index.ts)
- Auth/session semantics: [src/auth.ts](src/auth.ts)
- Chat request lifecycle: [src/routes.ts](src/routes.ts)
- Limiter identity strategy: [src/rate-limiter.ts](src/rate-limiter.ts)

Keep anonymous and authenticated behavior intentionally different.
