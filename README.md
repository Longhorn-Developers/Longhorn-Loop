# Longhorn Loop

Campus event discovery for UT Austin. An Expo / React Native app (iOS, Android,
web) talking to a Cloudflare Worker on D1.

## Quick start

You need **Node 22+** and a phone with [Expo Go](https://expo.dev/go), or an
emulator.

```bash
npm install
npx expo start
```

Scan the QR code with your phone. That's it — no backend setup, no database, no
Cloudflare account. A fresh clone talks to the deployed Worker, and verification
codes arrive in your real UT inbox, which is exactly what a beta tester
experiences.

On startup the app prints which backend it picked:

```
[api] https://loop-db.longhorn-developers.workers.dev  (default)
```

> **⚠️ That default writes to the production database.** Accounts you create and
> events you post are real, and other people will see them. That is the right
> default while the team is testing flows end to end, and the wrong one if you
> are experimenting — in which case run the backend locally (below).

## Running the backend locally

Do this when you are changing server code, or when you want to break things
without other people seeing it.

Open a second terminal, keeping Expo running in the first.

**Once:**

```bash
cd server
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 execute loop-db --env local --local --file=schema.sql
```

That last line builds your own SQLite copy of the database. Nothing you do
locally touches production and you do not need a Cloudflare account — the dev
scripts run against `[env.local]`, which omits the two bindings that would
otherwise require one.

`.dev.vars` is git-ignored and its defaults work as-is. It is optional:
`[env.local]` prints verification codes to this terminal instead of emailing
them, so you can sign in without it. Copy it anyway if you want a real
`RESEND_API_KEY` or the R2 image base URL.

**Every time:**

```bash
cd server
npm run dev:lan
```

`dev:lan` binds to `0.0.0.0` so a real phone on your wifi can reach it.
`npm run dev` binds to localhost only — fine for Expo web and the iOS
simulator, unreachable from a device.

Then point the app at it. Create a `.env` in the repo root:

```
EXPO_PUBLIC_USE_LOCAL_API=1
```

and restart Expo with `npx expo start --clear`. See `.env.example`.

## Things that will trip you up

**`EXPO_PUBLIC_*` is inlined at build time.** After editing `.env` you must
restart with `npx expo start --clear` _and_ reload the app. Editing it with
Metro already running does nothing, silently.

**Don't use `npx expo start --tunnel`.** It currently fails with
`Cannot read properties of undefined (reading 'body')` — an open bug in Expo's
ngrok wrapper ([expo#43335](https://github.com/expo/expo/issues/43335)), not
your setup. Plain `npx expo start` works. If you are on campus wifi and your
phone cannot see your laptop, turn on your phone's hotspot and join the laptop
to it.

**Run every `wrangler` command from `server/`.** `wrangler.toml` and
`schema.sql` both live there. From the repo root you get
`No environment found in configuration with name "local"` and
`Unable to read SQL text file`.

**Keep `--env local` on wrangler commands.** Without it you are pointed at the
_production_ database. `[env.local]` deliberately uses an invalid database id so
a stray deploy fails loudly instead of quietly standing up a second Worker wired
to prod.

**Node 22 or newer.** Part of the server test suite uses `node:sqlite` and skips
itself on older versions, so on Node 20 those tests appear to pass by not
running at all.

## Project layout

```
app/        Expo Router client — screens, components, hooks
server/     Cloudflare Worker — Hono routes, scrapers, D1 migrations
shared/     Imported by BOTH client and server; no React, no server-only APIs
site/       Static marketing + privacy pages
docs/       Design notes
```

Routing is file-based: a file in `app/` is a route. Start at
`app/(tabs)/home.tsx`.

## Before you push

CI runs these three on every PR to `main`, and all three must pass:

```bash
npm run lint
npm run format:check
npm run typecheck
```

Server tests are not yet in CI, so run them yourself when you touch `server/`:

```bash
cd server && npm test
```

## Conventions worth knowing

[`CLAUDE.md`](CLAUDE.md) is the real guide — it covers the architecture, the
scrapers, the feed ranking and the database. The three that bite newcomers
fastest:

- **Colours are `lhl*` tokens**, backed by CSS variables in `app/globals.css`.
  Never hardcode `bg-white` or a hex value, or dark mode breaks.
- **Fonts are per-weight families** — `font-roboto`, `font-roboto-medium`,
  `font-roboto-semibold`, `font-roboto-bold`. React Native cannot pick a weight
  off a variable font, so `font-bold` paired with a family will not work.
- **Query keys live in `app/lib/queryKeys.ts`**, never inline, so the
  hierarchical `invalidateQueries` prefixes keep working.

## More

- [`server/README.md`](server/README.md) — resetting the local database,
  migrations, deploying
- [`CLAUDE.md`](CLAUDE.md) — full architecture reference
- [Expo documentation](https://docs.expo.dev/)
