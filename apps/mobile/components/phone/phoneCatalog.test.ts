import {
  buildPhoneHome,
  CONTINUE_WATCHING_ID,
  ON_THIS_PHONE_ID,
  RECENTLY_ADDED_ID,
  type PhoneHomeInput,
} from "./phoneCatalog";
import type { StreamingVideo } from "../../stores/playback";
import type { MovieKind } from "../../../shared/mobile-sync-contract";

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
  onThisPhone: [],
  recentlyAdded: [],
  ...overrides,
});

describe("buildPhoneHome", () => {
  it("orders Continue watching, then On this phone, then Recently added", () => {
    const rows = buildPhoneHome(
      base({
        hasOfflineCopy: (id) => id === "off1",
        continueWatching: [
          { ...video("c1"), lastPositionSeconds: 10, lastWatchedAt: 1 },
        ],
        onThisPhone: [video("off1")],
        recentlyAdded: [video("v1"), video("v2")],
      }),
    );

    expect(rows.map((row) => row.id)).toEqual([
      CONTINUE_WATCHING_ID,
      ON_THIS_PHONE_ID,
      RECENTLY_ADDED_ID,
    ]);
    expect(rows[0].videos.map((item) => item.id)).toEqual(["c1"]);
    expect(rows[1].videos.map((item) => item.id)).toEqual(["off1"]);
    expect(rows[2].videos.map((item) => item.id)).toEqual(["v1", "v2"]);
  });

  it("adds the Movies and Episodes with an Offline copy to On this phone, newest first", () => {
    const hold = (id: string, heldAt: number, kind: MovieKind = "movie") => ({
      kind,
      id,
      title: id,
      posterUrl: null,
      durationSeconds: 6000,
      reasons: ["mirrored" as const],
      heldAt,
    });
    const rows = buildPhoneHome(
      base({
        connected: false,
        heldMovies: [
          hold("up", 2),
          hold("arriving", 3),
          hold("alien", 1),
          hold("pilot", 4, "episode"),
        ],
        hasMovieOfflineCopy: (id) => id !== "arriving",
      }),
    );

    expect(rows.map((row) => row.id)).toEqual([ON_THIS_PHONE_ID]);
    expect(rows[0].videos).toEqual([]);
    expect(rows[0].movies?.map((item) => [item.kind, item.id])).toEqual([
      ["episode", "pilot"],
      ["movie", "up"],
      ["movie", "alien"],
    ]);
  });

  it("omits On this phone row when empty or when no videos have an offline copy", () => {
    const rows = buildPhoneHome(
      base({
        hasOfflineCopy: () => false,
        onThisPhone: [video("not-held")],
        recentlyAdded: [video("v1")],
      }),
    );

    expect(rows.map((row) => row.id)).toEqual([RECENTLY_ADDED_ID]);
  });

  it("keeps only Offline copies when not connected", () => {
    const rows = buildPhoneHome(
      base({
        connected: false,
        hasOfflineCopy: (id) => id === "held",
        onThisPhone: [video("held")],
        recentlyAdded: [video("held"), video("stream-only")],
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(ON_THIS_PHONE_ID);
    expect(rows[0].videos.map((item) => item.id)).toEqual(["held"]);
    expect(rows[1].id).toBe(RECENTLY_ADDED_ID);
    expect(rows[1].videos.map((item) => item.id)).toEqual(["held"]);
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
