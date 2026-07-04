// Shape every scraper produces and every ingest call consumes.

export type ImageAspectRatio = 'vertical' | 'square' | 'horizontal' | 'none';

export interface NormalizedOrganization {
  // Null for sources that only expose department names (Texas Today, McCombs).
  // When null, ingest.ts skips the organizations upsert and stores only the
  // department name on the event row. See docs/org-profiles.md for the
  // reasoning + plan for eventually giving departments claimable pages.
  sourceOrgId: number | null;
  name: string;
  profilePicture: string | null;
}

export interface NormalizedEvent {
  source: string;
  sourceEventId: string;

  title: string;
  description: string | null;
  startDatetime: string;
  endDatetime: string | null;

  locationShort: string | null;
  locationFull: string | null;
  latitude: number | null;
  longitude: number | null;

  organization: NormalizedOrganization;

  eventUrl: string;
  rsvpUrl: string | null;

  imageUrl: string | null;
  imageAspectRatio: ImageAspectRatio;
  // McCombs: always set (parsed from the image header byte range).
  // Texas Today: sometimes set (Localist returns them on newer uploads).
  // HornsLink: never set.
  imageWidth: number | null;
  imageHeight: number | null;
  imageMimeType: string | null;
  imageAltText: string | null;

  theme: string | null;
  visibility: string;
  rsvpTotal: number;

  categories: { id: string; name: string | null }[];
  benefits: string[];
}

export interface IngestResult {
  inserted: number;
  updated: number;
  errors: string[];
}
