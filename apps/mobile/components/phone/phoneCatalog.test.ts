import {
  buildPhoneHome,
  CONTINUE_WATCHING_ID,
  RECENTLY_ADDED_ID,
  type PhoneHomeInput,
} from "./phoneCatalog";
import type { StreamingVideo } from "../../stores/playback";

const video = (id: string): StreamingVideo => ({
  id,
  title: `Video ${id}`,
  channelTitle: "Lab",
  duration: 60,
  thumbnailUrl: `thumb-${id}`,
});

const base = (overrides: Partial<PhoneHomeInput> = {}): PhoneHomeInput => ({
  connected: true,
  hasOfflineCopy: () => false,
  getStoredThumbnail: () => null,
  resolveAssetUrl: (url) => url ?? null,
  continueWatching: [],
  recentlyAdded: [],
  ...overrides,
});

describe("buildPhoneHome", () => {
  it("orders Continue watching then Recently added", () => {
    const rows = buildPhoneHome(
      base({
        continueWatching: [
          { ...video("c1"), lastPositionSeconds: 10, lastWatchedAt: 1 },
        ],
        recentlyAdded: [video("v1"), video("v2")],
      }),
    );

    expect(rows.map((row) => row.id)).toEqual([
      CONTINUE_WATCHING_ID,
      RECENTLY_ADDED_ID,
    ]);
    expect(rows[0].videos.map((item) => item.id)).toEqual(["c1"]);
    expect(rows[1].videos.map((item) => item.id)).toEqual(["v1", "v2"]);
  });

  it("keeps only Offline copies when not connected", () => {
    const rows = buildPhoneHome(
      base({
        connected: false,
        hasOfflineCopy: (id) => id === "held",
        recentlyAdded: [video("held"), video("stream-only")],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(RECENTLY_ADDED_ID);
    expect(rows[0].videos.map((item) => item.id)).toEqual(["held"]);
  });

  it("omits empty rows", () => {
    const rows = buildPhoneHome(
      base({
        connected: false,
        recentlyAdded: [video("missing")],
      }),
    );
    expect(rows).toEqual([]);
  });
});
