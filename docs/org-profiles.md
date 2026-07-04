# Organization profiles — model and roadmap

## Today

Events carry two org-related columns:

- `host_organization_id` (nullable FK to `organizations.id`)
- `host_organization_name` (plain text, always populated)

The `organizations` table is keyed by the source's stable numeric id. It
holds the org's display name, profile picture, and (eventually) claim /
verification state.

Whether we write an `organizations` row depends on the source:

| Source      | `sourceOrgId` | Behavior                                                            |
| ----------- | ------------- | ------------------------------------------------------------------- |
| HornsLink   | number        | Upsert into `organizations`, link event via `host_organization_id`. |
| Texas Today | null          | Skip `organizations`. Event stores name only.                       |
| McCombs     | null          | Skip `organizations`. Event stores name only.                       |

`NormalizedOrganization.sourceOrgId` in `server/src/events/types.ts`
encodes this: HornsLink hands us the number, the others hand us null.
`ingest.ts` checks the field and skips the org upsert when null.

## Why HornsLink events get org rows and department events don't

HornsLink orgs are independent, brand-y entities (SGA, MSA, IEEE,
Longhorn Robotics, etc.). Each one competes for members, wants their
own presence, and can plausibly claim + verify their page.

Texas Today and McCombs events come from academic units — the McCombs
School of Business, the BBA program, the GSLI office. Those are
institutional and don't "sign up" for Loop the way a student org does.
There's no obvious owner to claim the page, and forcing them into the
`organizations` table would create weird questions ("is McCombs+ the
same org as McCombs BBA?"). Keeping the department name as a plain
text field on the event avoids that.

## Claim + verification flow (roadmap)

Not built yet. When we build it, the outline is:

1. Org page reachable at `/org/[sourceOrgId]` (HornsLink orgs only for
   v1). Shows profile picture, name, and their events.
2. "Is this your org?" CTA opens a claim flow. Applicant supplies an
   email at the org's domain or a verification code we hand out
   manually to anchor orgs.
3. On approval, `organizations.verified` flips to 1. Loop displays
   the verified badge next to the org name on event cards and detail
   screens.
4. Verified orgs get admin controls: edit profile picture, hide events,
   add a description.

## Department profiles (future)

If we later decide departments deserve claimable pages (e.g. an
official McCombs presence with pinned events), the pipeline supports
it two ways:

1. Add a lookup table `department_orgs (source, name, org_id)` that
   maps a department name to a manually-created `organizations.id`.
   The scraper checks this table before deciding whether to leave
   `sourceOrgId` null.
2. Change the ingest layer to auto-create org rows keyed by
   `(source, name)` for null-id sources. Cheaper but risks duplicate
   rows when the same department appears under slightly different
   names.

Option 1 is preferable — deliberate, low volume, no dedupe hell.

## Source-of-truth summary

- Display name on a card → `events.host_organization_name` (always
  present, snapshot from scrape time).
- Verified badge / org page link → only when
  `events.host_organization_id` is non-null.
- Anything a user "claims" or "follows" → the `organizations` row,
  keyed by the source's numeric id.
