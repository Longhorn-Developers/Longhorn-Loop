# Longhorn Loop

UT Austin campus event discovery app. Expo / React Native client (iOS, Android, web) talking to a
Cloudflare Worker backend on D1.

Ticket ids (`LOOP-###`) appear throughout the code comments and map to the team's tracker. Existing
comments in this repo are unusually detailed and explain _why_ a decision was made — read them before
changing the thing they describe, and keep that standard when adding code.

## Repo layout

```
app/          Expo Router client (screens, components, hooks, client libs)
server/       Cloudflare Worker (Hono routes, scrapers, D1 migrations)
shared/       Dependency-free modules imported by BOTH client and server
site/         Static marketing + privacy pages
docs/         Design notes (org-profiles.md)
```

`shared/` must stay free of React, SVG imports, and server-only APIs — the client imports it via the
`@/` alias, the server via relative paths.

## Commands

Client (repo root):

```
npx expo start          # dev server
npm run lint            # eslint (CI)
npm run format:check    # prettier (CI)
npm run typecheck       # tsc --noEmit (CI)
```

Server (`server/`):

```
npm run dev             # wrangler dev --env local
npm run dev:lan         # same, bound to 0.0.0.0 for a physical device
npm test                # vitest
```

CI (`.github/workflows/ci.yml`) runs lint, format:check, and typecheck on PRs to `main`. All three
must pass.

## Frontend (`app/`)

- **Expo Router**, file-based. Route groups: `(auth)`, `(onboarding)`, `(tabs)` (home / explore /
  create / profile). Other stacks: `event/[id]`, `org/[id]` (public profile _and_ management
  console), `org/register`, `user/[id]`, `profile/*`, `settings/*`, `view-all`, `notifications`.
- **Root layout** (`app/_layout.tsx`) mounts `QueryClientProvider` → `OnboardingProvider` →
  `ThemeProvider` → animated splash → `ThemedStack`. One `QueryClient`, 30s `staleTime`, `retry: 1`.
- **Styling**: NativeWind/Tailwind. Every colour is a `lhl*` token backed by a CSS variable in
  `app/globals.css` (`:root` light, `.dark` dark) — never hardcode `bg-white` or hex values, or dark
  mode breaks. `darkMode: 'class'` so the Settings toggle can drive it.
- **Fonts**: each weight is its own registered family (RN can't pick a weight off a variable font).
  Use `font-roboto`, `font-roboto-medium`, `font-roboto-semibold`, `font-roboto-bold` — not
  `font-bold` paired with a family.
- **Server state**: TanStack Query only. Query keys are centralized in `app/lib/queryKeys.ts`
  (`events`, `saved`, `notifications`, `user`, `settings`, `org`, `feed`) — add keys there, never
  inline, so the hierarchical `invalidateQueries` prefixes keep working.
- **API client**: `app/lib/api.ts` wraps fetch (auth header, JSON parse, `ApiError`). Unreachable
  server surfaces as `ApiError` with `status: 0` / `isNetworkError`.
- **Session**: `app/lib/session.ts`. JWT in SecureStore (keychain / Android encrypted store), falls
  back to `sessionStorage` on web. Caches an `onboardingComplete` flag so cold start can route
  without a network call; the server's `users.onboarding_completed` is the source of truth.
- **Context**: `ThemeContext`, `OnboardingContext`, `CreateEventContext` (the multi-step create-event
  wizard).

### Backend URL selection (`app/config/api.ts`)

The default in **dev and prod** is the deployed Worker
(`https://loop-db.longhorn-developers.workers.dev`), which writes to the **production database**.
A fresh clone therefore needs no wrangler, no D1, no Cloudflare account.

- `EXPO_PUBLIC_USE_LOCAL_API=1` → local `wrangler dev` on port 8787 (host derived from the Expo host
  URI so a physical device works).
- `EXPO_PUBLIC_API_BASE_URL=...` → exact URL; wins over both. In release builds only `https://`
  overrides are honoured.

`EXPO_PUBLIC_*` is inlined at build time — after editing `.env` you must restart with
`npx expo start --clear` _and_ reload the app. The chosen base URL is logged at startup.

## Backend (`server/`)

Hono on Cloudflare Workers. Entry: `server/src/worker.ts`.

**Bindings**: `DB` (D1 `loop-db`), `EVENT_IMAGES` (R2), `AI` (Workers AI embeddings), `VECTORIZE`
(`loop-event-tags` index), plus `JWT_SECRET` / email provider secrets. `AI` and `VECTORIZE` have no
local emulation, so `[env.local]` in `wrangler.toml` deliberately omits them — every call site guards
on the binding being absent. Bindings are _not_ inherited by named environments; anything added at
top level that's needed at request time must be repeated under `env.local`.

**Routes** (`server/src/routes/*.worker.ts`, mounted in `worker.ts`):

| Mount            | File                      | Notable endpoints                                                                                                                                                                    |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/auth`          | `auth.worker.ts`          | `send-code`, `verify-code`, `resend-code`, `me`                                                                                                                                      |
| `/users`         | `users.worker.ts`         | `me`, `me/profile`, `me/socials`, `me/events`, `me/past-events`, `me/delete/*`, `:userId/profile`, `:userId/follow`, `:userId/block`                                                 |
| `/events`        | `events.worker.ts`        | `create`, `PATCH /:id`, `/:id`, `/:id/rsvp`, `/:id/attendees`, `/:id/view`, `/:id/report`, `scrape/:name`, `reclassify`, `seed-tag-vectors`                                          |
| `/feed`          | `feed.worker.ts`          | `home`, `explore`, `bucket/:id`                                                                                                                                                      |
| `/orgs`          | `orgs.worker.ts`          | `mine`, `search`, `register/*`, `:orgId`, `:orgId/members`, `:orgId/invites`, `:orgId/events`, `:orgId/analytics`, `:orgId/profile`, `:orgId/follow`, `:orgId/notification-settings` |
| `/saved`         | `saved.worker.ts`         | list, `POST/DELETE /:eventId`                                                                                                                                                        |
| `/settings`      | `settings.worker.ts`      | get/patch settings, `followed-orgs`, `feedback`                                                                                                                                      |
| `/notifications` | `notifications.worker.ts` | list, delete one, delete all                                                                                                                                                         |

CORS must list `PATCH` — most partial updates use it and the preflight fails otherwise.

**Auth**: UT email → 6-digit code (hashed in `verification_codes`) → JWT good for 7 days.
`server/src/lib/utils.ts` has `getAuthUser` / `getUserId`. Email goes through
`server/src/email/send.ts`, provider selected by the `EMAIL_PROVIDER` var (`resend` in prod, `dev`
locally — codes print to the console). The sending domain matters: UT's Proofpoint gateway rejected
`longhornloop.me` outright and accepts `longhorndevelopers.org`. Don't change `EMAIL_FROM` without
re-testing delivery to a real `@utexas.edu` address.

**Crons** (`[triggers]` in `wrangler.toml`, dispatched by `event.cron` in `scheduled()`):

- `0 */6 * * *` — every scraper in `SCRAPERS`
- `*/15 * * * *` — reminder notifications for saved events starting within 2 hours
- `0 8 * * *` — `ORG_DIRECTORY_SCRAPER` (HornsLink org directory; writes `organizations` only)

**Ingest pipeline**: `scrapers/*` → `events/normalize.ts` → `events/ingest.ts` (upserts org + event,
sets `expires_at` = end + 7d) → `lib/semanticTags.ts` (Workers AI embedding matched against the
taxonomy vectors in Vectorize) with `lib/classifier.ts` keyword matching as the fallback. Tag rows
record `source` (`semantic` | `keyword`) and `score`.

Scrapers are registered in `server/src/scrapers/registry.ts` — adding one is a new file plus a line
there. `hornslink` (events) is currently disabled as too noisy; `hornslinkOrgs` is a separate
orgs-only scraper on the daily cron. `manual` entries are exposed at `POST /events/scrape/:name` for
testing and should not be called in production.

**Feed ranking** (`server/src/lib/scoring.ts`):
`score = 0.5*interest + 0.25*popularity + 0.2*timeliness + 0.05*featured`, each term normalized to
~[0,1]. Popularity blends rsvp:3 / save:2 / view:1 with a log squash (midpoint 20); timeliness has a
72h half-life. Candidate pool capped at 500; D1 allows 100 bound params per statement, so id lists
are chunked at 90.

## Database

Schema of record: `server/schema.sql`; incremental changes go in `server/migrations/NNNN_*.sql`
(numbered, apply in order). Key tables:

- **Users**: `users` (incl. `avatar_config` JSON + `profile_photo_url`, `bio`, agreement flags,
  `onboarding_completed`), `user_majors`, `user_tags`, `user_socials` (max 3, enforced in the
  handler), `user_follows`, `user_blocks` (directional rows, mutual effect), `user_settings`,
  `verification_codes`
- **Events**: `events` (denormalized `save_count` / `rsvp_count` / `view_count`, `is_featured`,
  soft-delete via `is_archived`, `UNIQUE(source, source_event_id)`), `event_tags`,
  `event_categories`, `event_benefits`, `saved_events`, `event_rsvps`, `event_views`,
  `event_reports` (5 reports hides an event from everyone)
- **Orgs**: `organizations` (verification via president email claim), `org_members`
  (`admin` | `editor`), `org_invites` (keyed by email — invitee may not have an account yet),
  `org_followers`, `org_follows`, `org_notification_settings`,
  `followed_org_notification_settings`
- **Other**: `notifications`, `feedback` (`ON DELETE SET NULL` so bug reports survive account
  deletion), `categories`

Counters on `events` are maintained inline by the save / rsvp / view endpoints and count distinct
users, not raw pings.

## Shared (`shared/`)

`taxonomy.ts` is the single source of truth for interest buckets and tags — `bucket.id` is the FK in
`event_tags.bucket_id`, the client decorates it with icons in `app/lib/interestCategories.ts`, and
the classifier/feeds derive from it. Also: `avatar.ts` (Bevo config + display precedence),
`utEmail.ts`, `socialPlatforms.ts`, `orgRegistration.ts`, `profileEventFilters.ts`, `jwtExpiry.ts`,
`bio.ts`.

## Conventions

- TypeScript strict; `@/*` path alias from the repo root.
- Prettier: single quotes, trailing commas, 2 spaces, semicolons, width 100.
- Match the existing comment style: explain the _why_, especially for anything that cost debugging
  time or that looks wrong at first glance.
- Prefer editing shared constants (taxonomy, colour tokens, query keys) over duplicating values.
