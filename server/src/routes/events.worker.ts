// Events routes for Cloudflare Worker
import { Hono } from "hono";
import type { Env } from "../worker";
import { scrapeHornsLink } from "../scrapers/hornslink";

export const eventRoutes = new Hono<{ Bindings: Env }>();

// GET /events -- list upcoming events with optional filters
eventRoutes.get("/", async (c) => {
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = parseInt(c.req.query("offset") || "0");
  const category = c.req.query("category");
  const benefit = c.req.query("benefit");
  const theme = c.req.query("theme");
  const orgId = c.req.query("orgId");

  let query = `
    SELECT e.*, o.profile_picture as org_profile_picture
    FROM events e
    LEFT JOIN organizations o ON e.host_organization_id = o.id
    WHERE e.status = 'active'
      AND e.end_datetime > datetime('now')
  `;
  const params: any[] = [];

  if (theme) {
    query += ` AND e.theme = ?`;
    params.push(theme);
  }

  if (orgId) {
    query += ` AND e.host_organization_id = ?`;
    params.push(parseInt(orgId));
  }

  if (category) {
    query += ` AND e.id IN (SELECT event_id FROM event_categories WHERE category_name = ?)`;
    params.push(category);
  }

  if (benefit) {
    query += ` AND e.id IN (SELECT event_id FROM event_benefits WHERE benefit_name = ?)`;
    params.push(benefit);
  }

  query += ` ORDER BY e.start_datetime ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const events = await c.env.DB.prepare(query)
    .bind(...params)
    .all();

  // Attach categories and benefits to each event
  const enrichedEvents = [];
  for (const event of events.results) {
    const categories = await c.env.DB.prepare(
      "SELECT category_id, category_name FROM event_categories WHERE event_id = ?",
    )
      .bind(event.id)
      .all();

    const benefits = await c.env.DB.prepare(
      "SELECT benefit_name FROM event_benefits WHERE event_id = ?",
    )
      .bind(event.id)
      .all();

    enrichedEvents.push({
      ...event,
      categories: categories.results.map((c: any) => ({
        id: c.category_id,
        name: c.category_name,
      })),
      benefits: benefits.results.map((b: any) => b.benefit_name),
    });
  }

  return c.json({
    events: enrichedEvents,
    total: events.results.length,
    limit,
    offset,
  });
});

// GET /events/:id -- single event detail
eventRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const event = await c.env.DB.prepare(
    `SELECT e.*, o.profile_picture as org_profile_picture
     FROM events e
     LEFT JOIN organizations o ON e.host_organization_id = o.id
     WHERE e.id = ?`,
  )
    .bind(id)
    .first();

  if (!event) {
    return c.json({ error: "EVENT_NOT_FOUND" }, 404);
  }

  const categories = await c.env.DB.prepare(
    "SELECT category_id, category_name FROM event_categories WHERE event_id = ?",
  )
    .bind(id)
    .all();

  const benefits = await c.env.DB.prepare(
    "SELECT benefit_name FROM event_benefits WHERE event_id = ?",
  )
    .bind(id)
    .all();

  return c.json({
    ...event,
    categories: categories.results.map((c: any) => ({
      id: c.category_id,
      name: c.category_name,
    })),
    benefits: benefits.results.map((b: any) => b.benefit_name),
  });
});

// POST /events/scrape -- manually trigger a scrape (for testing)
eventRoutes.post("/scrape", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const maxPages = (body as any).maxPages ?? 3;
  const dryRun = (body as any).dryRun ?? false;

  const result = await scrapeHornsLink(c.env.DB, { maxPages, dryRun });

  return c.json(result);
});
