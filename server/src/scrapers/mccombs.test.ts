import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildLocationFull,
  buildLocationShort,
  classifyAspectRatio,
  cleanHostOrganization,
  decodeHtmlEntities,
  extractLocs,
  extractRsvpUrl,
  extractSourceEventId,
  parseEventFromHtml,
  parseImageDimensions,
  upgradeImageUrl,
} from "./mccombs";

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, "__fixtures__", "mccombs", name), "utf-8");
}

describe("parseEventFromHtml", () => {
  it("parses a standard event with a flyer image", () => {
    const parsed = parseEventFromHtml(loadFixture("standard.html"), "https://example.com");
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe("mccombs");
    expect(parsed?.source_event_id).toBe("12001");
    expect(parsed?.title).toBe("MSITM Lunch and Learn: Data Careers");
    expect(parsed?.start_datetime).toBe("2026-09-15T17:00:00+00:00");
    expect(parsed?.end_datetime).toBe("2026-09-15T18:00:00+00:00");
    expect(parsed?.host_organization_name).toBe("MSITM");
    expect(parsed?.location_short).toBe("GSB 2.122");
    expect(parsed?.location_full).toBe("GSB 2.122, 2110 Speedway, Austin, TX 78705");
    expect(parsed?.image_url).toBe(
      "https://calendar.mccombs.utexas.edu/live/image/gid/9/lunch-and-learn-flyer.jpg",
    );
    expect(parsed?.rsvp_url).toBeNull();
  });

  it("handles an RSVP-required event with no image and no explicit link", () => {
    const parsed = parseEventFromHtml(loadFixture("rsvp-required.html"), "https://example.com");
    expect(parsed).not.toBeNull();
    expect(parsed?.host_organization_name).toBe("Herb Kelleher Center");
    expect(parsed?.description).toContain("RSVP required");
    expect(parsed?.description).not.toContain("&amp;");
    expect(parsed?.image_url).toBeNull();
    expect(parsed?.image_aspect_ratio).toBe("none");
    expect(parsed?.rsvp_url).toBeNull();
  });

  it("extracts a bare external registration URL from the description", () => {
    const parsed = parseEventFromHtml(
      loadFixture("external-registration.html"),
      "https://example.com",
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.rsvp_url).toBe(
      "https://www.eventbrite.com/e/mccombs-partner-info-session-123456789",
    );
    expect(parsed?.location_short).toBe("Virtual Event");
  });

  it("handles an event with no flyer image", () => {
    const parsed = parseEventFromHtml(loadFixture("no-flyer.html"), "https://example.com");
    expect(parsed).not.toBeNull();
    expect(parsed?.image_url).toBeNull();
    expect(parsed?.image_width).toBeNull();
    expect(parsed?.image_aspect_ratio).toBe("none");
    expect(parsed?.host_organization_name).toBe("Global Sustainability Leadership Institute");
  });

  it("returns null when no Event JSON-LD is present", () => {
    const parsed = parseEventFromHtml("<html><body>no events here</body></html>", "https://example.com/foo");
    expect(parsed).toBeNull();
  });
});

describe("cleanHostOrganization", () => {
  it("strips the McCombs boilerplate suffix", () => {
    expect(
      cleanHostOrganization(
        "Alumni Engagement (McCombs School of Business - The University of Texas at Austin)",
      ),
    ).toBe("Alumni Engagement");
  });

  it("returns the name unchanged when there's no suffix to strip", () => {
    expect(cleanHostOrganization("Harkey Institute")).toBe("Harkey Institute");
  });

  it("returns null for missing organizer", () => {
    expect(cleanHostOrganization(undefined)).toBeNull();
    expect(cleanHostOrganization(null)).toBeNull();
  });
});

describe("extractSourceEventId", () => {
  it("extracts the numeric id from an event URL", () => {
    expect(
      extractSourceEventId(
        "https://calendar.mccombs.utexas.edu/alumni/event/11049-los-angeles-alumni-chapter",
      ),
    ).toBe("11049");
  });

  it("falls back to the URL path for vanity-slug events with no numeric id", () => {
    expect(
      extractSourceEventId("https://calendar.mccombs.utexas.edu/event/career-expo"),
    ).toBe("event/career-expo");
    expect(
      extractSourceEventId(
        "https://calendar.mccombs.utexas.edu/recruiters-corporations/event/career-expo",
      ),
    ).toBe("recruiters-corporations/event/career-expo");
  });

  it("returns null for an unparseable URL with no path", () => {
    expect(extractSourceEventId("not a url")).toBeNull();
  });
});

describe("buildLocationShort / buildLocationFull", () => {
  it("takes the venue name before the first comma, truncated to 40 chars", () => {
    expect(buildLocationShort("GSB 2.122, 2110 Speedway, Austin, TX 78705")).toBe("GSB 2.122");
  });

  it("falls back to the full string when there's no comma", () => {
    expect(buildLocationShort("CBA 3.302")).toBe("CBA 3.302");
  });

  it("truncates long single-segment locations to 40 chars", () => {
    const long = "Avalon Beverly Hills - 9400 West Olympic Blvd. Beverly Hills";
    const short = buildLocationShort(long);
    expect(short?.length).toBeLessThanOrEqual(40);
    expect(short?.endsWith("...")).toBe(true);
  });

  it("returns null for missing location", () => {
    expect(buildLocationShort(null)).toBeNull();
    expect(buildLocationFull(undefined)).toBeNull();
  });

  it("decodes HTML entities in the full location", () => {
    expect(buildLocationFull("AT&amp;T Hotel &amp; Conference Center")).toBe(
      "AT&T Hotel & Conference Center",
    );
  });
});

describe("classifyAspectRatio", () => {
  it("classifies horizontal, vertical, square, and none", () => {
    expect(classifyAspectRatio(1200, 800)).toBe("horizontal");
    expect(classifyAspectRatio(800, 1200)).toBe("vertical");
    expect(classifyAspectRatio(1000, 1000)).toBe("square");
    expect(classifyAspectRatio(null, null)).toBe("none");
    expect(classifyAspectRatio(0, 0)).toBe("none");
  });

  it("uses a 5% tolerance band around square", () => {
    expect(classifyAspectRatio(1030, 1000)).toBe("square");
    expect(classifyAspectRatio(1060, 1000)).toBe("horizontal");
  });
});

describe("upgradeImageUrl", () => {
  it("strips the resize/crop path segment to get the original upload", () => {
    expect(
      upgradeImageUrl(
        "https://calendar.mccombs.utexas.edu/live/image/gid/7/width/600/height/600/crop/1/src_region/0,0,2560,2560/74_KBH_Symposium.png",
      ),
    ).toBe("https://calendar.mccombs.utexas.edu/live/image/gid/7/74_KBH_Symposium.png");
  });

  it("is idempotent on URLs that are already original", () => {
    const url = "https://calendar.mccombs.utexas.edu/live/image/gid/7/flyer.png";
    expect(upgradeImageUrl(url)).toBe(url);
  });

  it("returns null for missing input", () => {
    expect(upgradeImageUrl(null)).toBeNull();
  });
});

describe("extractRsvpUrl", () => {
  it("finds a bare URL in the description", () => {
    expect(extractRsvpUrl("Register at https://example.com/register.")).toBe(
      "https://example.com/register",
    );
  });

  it("returns null when there's no URL", () => {
    expect(extractRsvpUrl("RSVP required to attend.")).toBeNull();
    expect(extractRsvpUrl(null)).toBeNull();
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes common entities", () => {
    expect(decodeHtmlEntities("AT&amp;T &lt;tag&gt; &quot;quote&quot; &#39;s&#39;")).toBe(
      `AT&T <tag> "quote" 's'`,
    );
  });
});

describe("extractLocs", () => {
  it("extracts <loc> entries from sitemap XML", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://calendar.mccombs.utexas.edu/alumni/event/1-a</loc></url>
        <url><loc>https://calendar.mccombs.utexas.edu/gsli/event/2-b</loc></url>
      </urlset>`;
    expect(extractLocs(xml)).toEqual([
      "https://calendar.mccombs.utexas.edu/alumni/event/1-a",
      "https://calendar.mccombs.utexas.edu/gsli/event/2-b",
    ]);
  });

  it("returns an empty array when there are no <loc> entries", () => {
    expect(extractLocs("<urlset></urlset>")).toEqual([]);
  });
});

describe("parseImageDimensions", () => {
  it("reads width/height from a PNG header", () => {
    // Minimal valid PNG header: signature + IHDR chunk declaring 600x400.
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 600);
    view.setUint32(20, 400);
    expect(parseImageDimensions(bytes)).toEqual({ width: 600, height: 400 });
  });

  it("reads width/height from a GIF header", () => {
    const bytes = new Uint8Array(10);
    bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
    const view = new DataView(bytes.buffer);
    view.setUint16(6, 320, true);
    view.setUint16(8, 240, true);
    expect(parseImageDimensions(bytes)).toEqual({ width: 320, height: 240 });
  });

  it("reads width/height from a baseline JPEG SOF0 marker", () => {
    // SOI, then a single SOF0 (0xFFC0) segment: length=17, precision=8,
    // height=300, width=500, 1 component (minimal valid payload).
    const bytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xc0, // SOF0
      0x00, 0x11, // segment length = 17
      0x08, // precision
      0x01, 0x2c, // height = 300
      0x01, 0xf4, // width = 500
      0x01, // number of components
      0x01, 0x22, 0x00, // component data
    ]);
    expect(parseImageDimensions(bytes)).toEqual({ width: 500, height: 300 });
  });

  it("returns null for unrecognized data", () => {
    expect(parseImageDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
