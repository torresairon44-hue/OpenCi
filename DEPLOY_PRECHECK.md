# Deployment Precheck

Use this checklist before every release.

## 1) Security

- Rotate any key that was ever exposed in chat, screenshots, logs, or docs.
- Ensure `.env` is never committed.
- Verify production keys are loaded from your host secret manager.

## 2) Environment

Required runtime variables:

- `PORT`
- `JWT_SECRET`

Required PostgreSQL variables:

- `PG_HOST`
- `PG_PORT`
- `PG_USER`
- `PG_PASSWORD`
- `PG_DATABASE`

AI variables (at least one recommended):

- `GROQ_API_KEY`
- `GOOGLE_AI_API_KEY`

## 3) Build and Gate

Strict gate (recommended):

```bash
npm run deploy:check
```

If you intentionally allow empty tests:

```bash
npm run deploy:check:allow-empty-tests
```

## 4) Runtime Smoke

Start service:

```bash
npm start
```

Health endpoint must return status ok:

- `GET /api/health`

Production hardening checks:

- `GET /api/dev/db/tables` should be forbidden in production.
- Unknown API route should return JSON 404.

## 5) Supabase Notes

For this backend, Supabase is used via PostgreSQL connection settings (`PG_*`).

`NEXT_PUBLIC_*` Supabase variables are frontend-oriented and are not required for backend DB connectivity in this codebase.
