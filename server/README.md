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
npm run dev:lan
```

Worker is now running on port 8787. The app's `app/config/api.ts` points at it
automatically in dev mode, so `npx expo start` in the repo root just works.

### Why `dev:lan` and not `wrangler dev`

`wrangler dev` binds to localhost only, which is fine for the iOS simulator and
Expo web (same machine) but unreachable from a real phone. `npm run dev:lan`
adds `--ip 0.0.0.0` so the Worker also accepts connections from other devices
on your network. Use `npm run dev:worker` if you specifically want the
localhost-only bind.

## Testing on a physical phone

Expo Go on a real device cannot resolve `localhost` to your dev machine --
`localhost` is the phone. Two things have to be true:

1. **The Worker accepts LAN connections.** Start it with `npm run dev:lan`.
2. **The phone and the dev machine are on the same network.** University Wi-Fi
   that isolates clients (and most guest networks) will block this even when
   both devices show as connected.

The app derives the dev machine's address from the same host Metro served the
bundle from, so no IP needs to be typed in. If a request still fails, the error
now names the exact URL it tried, e.g.

```
Network request failed. Could not reach http://192.168.1.24:8787 -- check that
the Worker is running (`npm run dev:lan` in /server) and that this device is on
the same network as the dev machine.
```

Verify that URL from the phone's browser: it should return `{"status":"ok"}` at
`/health`. If the browser can't load it either, it's the network or the bind,
not the app.

### Overriding the API URL

Set `EXPO_PUBLIC_API_BASE_URL` in a root `.env` to point the app somewhere else
-- the deployed Worker, a teammate's machine, or a tunnel. This is required
when running `expo start --tunnel`, since the tunnel only proxies Metro and not
port 8787.

```bash
EXPO_PUBLIC_API_BASE_URL=https://loop-db.longhorn-developers.workers.dev
```

### Seed events

Manual scrapes are triggered per source via `POST /events/scrape/:name`.
Available sources: `hornslink`, `mccombs`, `texasGlobal`, `lawSchool`,
`cockrell`, `cofa`.

```bash
curl -X POST http://localhost:8787/events/scrape/hornslink \
  -H "Content-Type: application/json" \
  -d '{"maxPages":3}'
```

Pulls events from HornsLink into your local D1.

```bash
curl -X POST http://localhost:8787/events/scrape/mccombs \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true}'
```

Scrapes McCombs events (`calendar.mccombs.utexas.edu`). Pass `"dryRun":true`
to log what would be written without touching D1, or omit it (or set
`false`) to upsert for real. `maxEvents` caps how many events are processed
(default 500).

## Secrets

- `.dev.vars` — used by `wrangler dev`. Git-ignored. Copy `.dev.vars.example` to start.
- `.dev.vars.example` — template, committed.
- Production secrets — set via `wrangler secret put NAME` (needs Cloudflare access).

## Event Images

User-created event uploads are stored in the `longhorn-loop-event-images`
R2 bucket through the Worker binding `EVENT_IMAGES`.

Set `EVENT_IMAGE_PUBLIC_BASE_URL` to the bucket's public r2.dev URL or a
custom domain, without a trailing slash. Uploaded objects are written under
`events/user-created/{userId}/{uuid}.{ext}` and the event row stores
`EVENT_IMAGE_PUBLIC_BASE_URL` plus that object key.

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
