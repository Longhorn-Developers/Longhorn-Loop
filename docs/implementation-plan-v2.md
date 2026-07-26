## Implementation plan (v2 — fresh build)

Rebuilding from a clean `main` (no prototype code merged). Ordered so **each phase ships something testable** before the next. Key changes from v1: **Cloudflare Vectorize** is now the vector store (not in-memory cosine), tags are **vectorized individually** (avoids the blended-vector dilution we hit), **semantic tagging at ingest is the primary path with the keyword classifier as the AI-down fallback** (see "Semantic architecture"), and the taxonomy is a **shared client/server module**.

### Phase 0 · Shared taxonomy module _(do first — everything depends on it)_

The 16 buckets + tags currently live in `app/lib/interestCategories.ts`, but it imports SVGs + React, so the server can't reuse it. Extract the **data** (ids, labels, tags — no icons) into a framework-neutral file both sides import; the client file keeps decorating it with icons/copy.

- **Feasibility (investigated):** ✅ workable. Root `tsconfig` currently excludes `server/`, and server is CommonJS while app is ESM — so a naive cross-import fails. Cleanest: a plain `.ts` data module (no deps) under a shared path, imported by both. Alternative if build wiring is painful: keep two copies + a unit test that fails on drift.
- **Test:** both app and server typecheck importing the same bucket list.
- **Est:** 1 day · **Effort:** Low–Med (the risk is all in build wiring)

### Phase 1 · Signals (tables + endpoints)

- Tables: `event_rsvps`, `event_views`. All signals are **deduped per user** — one row per `(user_id, event_id)`, so counters track distinct users, not raw pings. Denormalized counters on `events`: `save_count`, `rsvp_count`, `view_count`. Counters are kept in sync **inline** in each endpoint (guarded on the insert/delete actually changing a row so re-pings don't inflate).
- Endpoints: `POST/DELETE /events/:id/rsvp`, `POST /events/:id/view`; saves already exist — just add the counter.
- App: replace the in-memory `rsvpStore` with real calls; add a view ping on detail-screen load; hydrate `is_rsvped`.
- **Test:** RSVP/save/view persist and counters increment (once per user); RSVP survives app restart.
- **Est:** 2–3 days · **Effort:** Med
- **Cut from original scope:**
  - **`event_clicks` / tap-to-expand** — dropped. Today tapping a card _is_ navigating to the detail page, so a click signal would be ~identical to a view. Revisit if/when the feed gains an expand-in-place interaction that differs from navigation.
  - **Per-user seen penalty** (see Phase 3 note) — dropped as a scoring input. It's a weak signal until we track scroll-level impressions, so Phase 3 scoring should not assume it.

### Phase 2 · Classifier + `event_tags`

- Server-side bucket source of truth (from Phase 0). Keyword classifier maps event text → bucket(s) + child tags. `event_tags(event_id, bucket_id, tag)` — many-to-many. Runs at ingest + a `/events/reclassify` backfill.
- **Test:** every event gets ≥1 bucket; spot-check tag accuracy on a sample.
- **Est:** 2–3 days · **Effort:** Med

### Phase 3 · Scoring + feed endpoints (no AI yet)

- `scoring.ts`: interest + popularity + timeliness + featured. (The per-user seen penalty is dropped — see Phase 1.)
- `/feed/home` (Upcoming + one carousel per selected bucket), `/feed/explore`, `/feed/bucket/:id`.
- App: wire Home + Explore to the new endpoints; delete the stale client-side taxonomy in `home.tsx`.
- **Test:** logged-in user sees personalized carousels, ranked. **This is a complete, shippable feed with no AI.**
- **Est:** 3–4 days · **Effort:** High

### Phase 4 · Contextual carousels

- "Because you're a _[major]_ major" and "_[year]_" rows (keyword-match user's major/year vocab against event text); min-count guard so near-empty rows don't show.
- Need a mapping with majors to college as a start, will need to use semantics to clean up event to major showcas
- **Test:** major/year rows appear for a test user with those fields set.
- **Est:** 1 day · **Effort:** Low

### Phase 5 · Semantic tagging — Workers AI + Vectorize (ingest-time, primary)

**Decision (see "Semantic architecture" below):** semantic matching becomes the **primary** way events get their tags. The keyword classifier is demoted to an **AI-down fallback**. This replaces the original "keyword classifier + separate semantic gate" design — done well, semantic tagging never mislabels in the first place, so there is nothing to gate out (the old Phase 6 collapses into the threshold here).

- Workers AI binding (embeddings) + **Vectorize** as the vector store.
- **Per-tag vectorization:** embed each taxonomy _tag_ individually (~100 vectors), stored once and rebuilt when the taxonomy changes. Represent a bucket as the set of its tag-vectors — match against the _closest tag_, not an averaged blob (the fix for blended-vector dilution).
- **At ingest, per event (the only place embeddings run):**
  1. Embed the event text once.
  2. Cosine-compare against every taxonomy tag-vector.
  3. **Threshold** → keep tags above the cutoff → `writeEventTags()`. This _is_ the gate; membership is decided here, once.
  - AI unavailable → fall back to `classifyEvent()` (keyword) so `event_tags` is never empty.
- **`event_tags` gains `source` (`'semantic' | 'keyword'`) + `score` (similarity)** so we can prefer semantic rows and, later, rank by score if we choose to.
- **No feed-time embedding.** `/feed/*` stays a dumb fast reader of `event_tags` — identical to today. `scoring.ts` is unchanged: exact tag-overlap (`interestScore`) remains the interest signal, on the bet that accurate ingest-time tags make exact-match good enough.
- **Test:** meaning-match assigns correct tags to events that share no keywords; a would-be mislabel (e.g. "Alumni Breakfast" → Interfaith) is _not_ assigned; AI-down path still writes keyword tags; feed does zero AI calls.
- **Est:** 4–5 days · **Effort:** High (Vectorize setup + per-tag representation + ingest embed path)

### Phase 6 · Tune the threshold (was: semantic gate)

- The standalone semantic gate is **absorbed into Phase 5's threshold** — no separate pass. This phase is just calibration: pick the similarity cutoff (globally or per-bucket) on real data so precision/recall feel right; spot-check that deliberately off-topic events don't get tagged.
- **Test:** a deliberately mislabeled event never enters the wrong carousel (because it never clears the threshold).
- **Est:** 1 day · **Effort:** Low–Med

### Phase 7 · Harden & launch

- Unit tests (scoring, classifier, semantic), weight tuning on real data, seed/share workflow (FK-safe dump), edge cases (anon users, AI-down fallback, per-bucket thresholds), docs.
- **Est:** 2–3 days · **Effort:** Med

---

**Rough total: ~2.5–3.5 weeks** (one focused engineer). Phases 1–4 = a full keyword feed with **no AI** (the early-launch cut line). Phase 5 upgrades _tagging_ from keyword to semantic at ingest; the keyword classifier stays as the AI-down fallback so the feed never breaks.

### Semantic architecture (Phase 5/6 decision)

- **Semantic tagging is primary; keyword classifier is the fallback floor.** Per-tag embeddings + a similarity threshold at ingest decide `event_tags` membership. When AI is unavailable, ingest falls back to the keyword `classifyEvent()` so `event_tags` is never empty. The classifier is therefore kept but no longer polished past "acceptable fallback."
- **Embeddings run only at ingest, never on the feed path.** Events are embedded once when scraped; `/feed/*` just reads `event_tags`. Ingest is a background cron nobody waits on, so its added latency/cost is invisible to users; feed latency is unchanged.
- **No semantic term in `scoring.ts` (yet).** We bet that accurate ingest-time tags make exact tag-overlap (`interestScore`) a good enough interest signal. Revisit only if it proves too coarse — see deferred item below.
- **The old per-bucket semantic gate is absorbed into the tagging threshold** — you can't mislabel and then need to un-label if the threshold gates membership up front.

**Deferred (post-launch, needs real engagement volume):**

- Collaborative filtering ("events similar users saved/RSVP'd," via user-behavior vectors) and impression-based feed rotation (needs card-level tracking, not just detail-page views).
- **Per-user semantic ranking term** — embed a per-user "taste vector" and blend a similarity score into `scoring.ts`. This is the _only_ piece that would put an embedding/Vectorize query on the feed path (it's per-user, so not precomputable per-event). Skipped by default; add only if exact tag-overlap personalization proves too coarse.

**Open decisions to make as we go:** Vectorize vs. storing vectors in D1 for our scale; the similarity threshold (global vs. per-bucket); which embedding model.
