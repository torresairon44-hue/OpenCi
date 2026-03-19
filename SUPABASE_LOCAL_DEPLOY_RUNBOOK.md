# Supabase + Local Deployment Runbook

This runbook is for this project's current stack:
- Backend: Node.js + Express
- Database: Supabase PostgreSQL via `PG_*` vars

## 1) Set Environment

Open `.env` and confirm these values:

```env
NODE_ENV=production
PORT=3000
JWT_SECRET=your-strong-secret

PG_HOST=db.ewfnlelpphmswregcwfg.supabase.co
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=your-real-supabase-db-password
PG_DATABASE=postgres

# At least one AI key is recommended
GROQ_API_KEY=your-groq-key
# OR
GOOGLE_AI_API_KEY=your-google-key
```

## 2) Install Dependencies

```bash
npm install
```

## 3) Run Deployment Gate

Flexible gate (allows no tests):

```bash
npm run deploy:check:allow-empty-tests
```

Strict gate (fails if no tests):

```bash
npm run deploy:check
```

## 4) Start Production Server

```bash
npm start
```

## 5) Verify Runtime

Health check should return status ok:

- `http://localhost:3000/api/health`

Automated one-command smoke check:

```bash
npm run smoke:health
```

Chained deployment smoke flow:

```bash
npm run smoke:deploy
```

If your shell is not already in production mode, set it first (PowerShell):

```powershell
$env:NODE_ENV='production'
npm run smoke:deploy
```

Production safety checks:

- `http://localhost:3000/api/dev/db/tables` should be forbidden
- Unknown API route should return JSON 404

## 6) Supabase Connectivity Notes

- Ensure your network/IP is allowed by Supabase project settings.
- Use the direct Postgres host and DB password from Supabase.
- This backend uses PostgreSQL driver (`pg`), not `@supabase/supabase-js` for DB connectivity.

## 7) Rollback Path

If startup fails after env changes:

1. Restore previous `.env` values.
2. Run `npm run build`.
3. Restart with `npm start`.
4. Re-check `http://localhost:3000/api/health`.
