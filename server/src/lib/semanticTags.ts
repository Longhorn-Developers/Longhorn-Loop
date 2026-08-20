// Semantic tagging: seed taxonomy tags into Vectorize, then match events
// against them at ingest.

import { TAXONOMY_BUCKETS } from '../../../shared/taxonomy';
import { embedText, embedTextBatch } from './utils';
import { classifyEvent } from './classifier';
import type { ClassifierMatch } from './classifier';
import type { Env } from '../worker';

const SEMANTIC_TOP_K = 10;

// bge-large scores compress into ~0.50-0.70. We keep the top match plus any
// within SCORE_MARGIN of it (capped at MAX_TAGS), gated by SCORE_FLOOR. The
// margin stays loose because score spread doesn't separate right from wrong
// tags on uncertain events; the feed ranker weights by score instead.
const SCORE_MARGIN = 0.04;
const MAX_TAGS = 3;
const SCORE_FLOOR = 0.55;

// Stable id so re-seeding overwrites a tag's row instead of duplicating it.
function tagVectorId(bucketId: string, tag: string): string {
  return `tag:${bucketId}:${tag}`;
}

// NOTE: KEEPING FOR NOW
// Some tag names drift into a generic "campus social" region and match
// unrelated events. A concrete description pulls the vector toward the tag's
// real meaning. Server-only (the app doesn't need these). Keyed by exact tag
// name; tags with no entry embed as bucket label + tag only.
const TAG_EMBEDDING_HINTS: Record<string, string> = {
  'Happy Hour Events': 'after-work drinks, cocktails, and bar specials in the evening',
  'LGBTQ+ Events': 'pride, queer community, and LGBTQ+ identity and advocacy gatherings',
  'Themed Parties': 'costume and themed dance parties with a specific dress code or motif',
  'Meetups & Mixers': 'casual social mixers to meet new people and network informally',
  'Trivia Nights': 'pub-quiz and trivia competition game nights',
  'Community Service': 'volunteering, charity, and community service projects',
};

// Prepend the bucket label so ambiguous tags ("Music", "Hardware") get context,
// and append a hint when one exists (see TAG_EMBEDDING_HINTS).
function tagEmbeddingText(bucketLabel: string, tag: string): string {
  const hint = TAG_EMBEDDING_HINTS[tag];
  return hint ? `${bucketLabel}: ${tag}. ${hint}` : `${bucketLabel}: ${tag}`;
}

export async function seedTagVectors(env: Env): Promise<{ upserted: number; failed: string[] }> {
  if (!env.AI || !env.VECTORIZE) {
    return { upserted: 0, failed: ['AI or VECTORIZE binding not configured'] };
  }

  const vectors: VectorizeVector[] = [];
  const failed: string[] = [];

  // Flatten to one list and embed in a single batched call (avoids the
  // per-invocation AI request cap; see embedTextBatch).
  const entries = TAXONOMY_BUCKETS.flatMap((bucket) =>
    bucket.tags.map((tag) => ({
      bucketId: bucket.id,
      tag,
      text: tagEmbeddingText(bucket.label, tag),
    })),
  );

  const embeddings = await embedTextBatch(
    env,
    entries.map((e) => e.text),
  );

  if (!embeddings) {
    return { upserted: 0, failed: entries.map((e) => e.tag) };
  }

  entries.forEach((entry, i) => {
    const vector = embeddings[i];
    if (!vector || vector.length === 0) {
      failed.push(entry.tag);
      return;
    }
    vectors.push({
      id: tagVectorId(entry.bucketId, entry.tag),
      values: vector,
      metadata: { bucketId: entry.bucketId, tag: entry.tag },
    });
  });

  if (vectors.length > 0) {
    await env.VECTORIZE.upsert(vectors);
  }

  return { upserted: vectors.length, failed };
}

// Remove stale tag vectors by id. Renaming/removing a tag retires its old id,
// which seeding leaves behind (upsert can't delete). The binding has no list
// method, so the caller passes the known old id(s): `tag:<bucketId>:<tagName>`.
export async function deleteTagVectors(env: Env, ids: string[]): Promise<{ deleted: number }> {
  if (!env.VECTORIZE || ids.length === 0) return { deleted: 0 };
  const result = await env.VECTORIZE.deleteByIds(ids);
  return { deleted: result?.count ?? ids.length };
}

// Assign tags from an already-computed embedding. Split from semanticClassify
// so bulk callers can batch the embed (the rate-capped step) and run this
// per-event query. Returns null below the floor so callers fall back to keyword.
export async function semanticClassifyVector(
  env: Env,
  vector: number[] | null,
): Promise<ClassifierMatch[] | null> {
  if (!env.VECTORIZE || !vector) return null;

  const result = await env.VECTORIZE.query(vector, {
    topK: SEMANTIC_TOP_K,
    returnMetadata: true,
  });

  // Matches are sorted by score descending. If the top is below the floor, the
  // event isn't really about any tag.
  const top = result.matches[0];
  if (!top || top.score < SCORE_FLOOR) return null;

  // Keep the top plus any within margin AND above the floor. The floor clamp
  // matters for weak tops: a 0.552 top would otherwise pull in 0.548 near-ties.
  const cutoff = Math.max(top.score - SCORE_MARGIN, SCORE_FLOOR);
  const matches: ClassifierMatch[] = [];
  for (const match of result.matches) {
    if (matches.length >= MAX_TAGS) break;
    if (match.score < cutoff) break;

    const meta = match.metadata as { bucketId?: string; tag?: string } | undefined;
    if (!meta?.bucketId || !meta?.tag) continue;

    matches.push({
      bucketId: meta.bucketId,
      tag: meta.tag,
      source: 'semantic',
      score: match.score,
    });
  }

  return matches.length > 0 ? matches : null;
}

// Single-event convenience: embed the text, then classify the vector. Used by
// the debug route. Bulk ingest embeds in batch instead (see classifyEventsBatch).
export async function semanticClassify(
  env: Env,
  title: string,
  description: string | null,
): Promise<ClassifierMatch[] | null> {
  if (!env.VECTORIZE) return null;
  const vector = await embedText(env, `${title} ${description ?? ''}`);
  return semanticClassifyVector(env, vector);
}

// Classify one event: semantic-primary, keyword only when semantic finds
// nothing. bge-large tags stand on their own; the keyword classifier fires on
// surface words ("party", "breakfast") and only adds noise when mixed in.
// Always returns at least one tag.
export async function classifyEventTags(
  env: Env,
  title: string,
  description: string | null,
): Promise<ClassifierMatch[]> {
  const semantic = await semanticClassify(env, title, description);
  if (semantic && semantic.length > 0) return semantic;
  return classifyEvent(title, description);
}

const EMBED_BATCH_SIZE = 50;

// Classify many events, embedding in batches. Per-event embedding in a loop
// exhausts the Workers AI per-invocation cap after a handful of events and
// drops the rest to keyword; batching keeps the whole scrape on the semantic
// path. Returns tags aligned by index (result[i] <-> events[i]).
export async function classifyEventsBatch(
  env: Env,
  events: Array<{ title: string; description: string | null }>,
): Promise<ClassifierMatch[][]> {
  const texts = events.map((e) => `${e.title} ${e.description ?? ''}`);
  const vectors: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const chunk = texts.slice(i, i + EMBED_BATCH_SIZE);
    const embedded = await embedTextBatch(env, chunk);
    // null = whole chunk failed; map to nulls so those events fall back to keyword.
    if (embedded) vectors.push(...embedded);
    else vectors.push(...chunk.map(() => null));
  }

  // Vectorize queries aren't rate-capped, so run them per event.
  const out: ClassifierMatch[][] = [];
  for (let i = 0; i < events.length; i++) {
    const semantic = await semanticClassifyVector(env, vectors[i]);
    out.push(
      semantic && semantic.length > 0
        ? semantic
        : classifyEvent(events[i].title, events[i].description),
    );
  }
  return out;
}
