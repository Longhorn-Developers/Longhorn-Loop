# Longhorn Loop — Server

Cloudflare Worker backend (Hono + D1). Deployed at
`loop-db.longhorn-developers.workers.dev` in production.

## Local setup

Works on macOS, Linux, and Windows — anywhere Node + Wrangler run.

```bash
cd server
npm install
cp .dev.vars.example .dev.vars   # defaults work for local dev
npx wrangler d1 execute loop-db --local --file=schema.sql
npx wrangler dev
```

Worker is now running at `http://localhost:8787`. The app's
`app/config/api.ts` already points there when running in dev mode, so
`npx expo start` in the repo root will use it automatically.

### Seed events

```bash
curl -X POST http://localhost:8787/events/scrape \
  -H "Content-Type: application/json" \
  -d '{"maxPages":3}'
```

Pulls ~60 events from HornsLink into your local D1.

## Secrets

- `.dev.vars` — used by `wrangler dev`. Git-ignored. Copy `.dev.vars.example` to start.
- `.dev.vars.example` — template, committed.
- Production secrets — set via `wrangler secret put NAME` (needs Cloudflare access).

### `RESEND_DEV_MODE`

When `RESEND_DEV_MODE=true`, `/auth/send-code` prints the verification
code to the wrangler console instead of calling Resend. Useful because
Resend's free tier only allows sending to one verified inbox, which
makes signup hard to test as a team.

To test signup locally:

1. Have `RESEND_DEV_MODE=true` in `.dev.vars`
2. Sign up in the app with any email
3. Look at the wrangler terminal — you'll see a line like:
   ```
   [DEV] Verification code for you@example.com: 123456
   ```
4. Paste that code into the verification screen

Never set `RESEND_DEV_MODE` in production.

## Useful commands

```bash
# inspect local D1
npx wrangler d1 execute loop-db --local --command="SELECT * FROM events LIMIT 5"

# wipe and re-seed local D1
npx wrangler d1 execute loop-db --local --command="DROP TABLE IF EXISTS events"
npx wrangler d1 execute loop-db --local --file=schema.sql

# tail prod Worker logs (needs Cloudflare access)
npx wrangler tail
```
