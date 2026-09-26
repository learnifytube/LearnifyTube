import { selectAutoKeep, type LatestVideo } from "./auto-keep";

const DAY = 24 * 60 * 60 * 1000;
const SINCE = 10 * DAY;

const video = (videoId: string, overrides: Partial<LatestVideo> = {}): LatestVideo => ({
  videoId,
  publishedAt: SINCE + 1,
  isShort: false,
  liveStatus: null,
  ...overrides,
});

const select = (videos: LatestVideo[], considered: string[] = []) =>
  selectAutoKeep({ videos, since: SINCE, considered: new Set(considered), limit: 5 });

describe("selectAutoKeep", () => {
  it("keeps a Video published after Auto-keep was switched on", () => {
    expect(select([video("new")])).toEqual({ keep: ["new"], markConsidered: ["new"] });
  });

  it("never keeps a Video published before Auto-keep was switched on, but remembers it", () => {
    expect(select([video("old", { publishedAt: SINCE - 2 * DAY })])).toEqual({
      keep: [],
      markConsidered: ["old"],
    });
  });

  it("keeps a Video dated up to a day early, as its approximate date may be rounded down", () => {
    expect(select([video("rounded", { publishedAt: SINCE - DAY })]).keep).toEqual(["rounded"]);
  });

  it("keeps nothing and considers everything listed when taking the baseline", () => {
    const videos = [video("a"), video("b", { isShort: true })];
    expect(selectAutoKeep({ videos, since: Infinity, considered: new Set() })).toEqual({
      keep: [],
      markConsidered: ["a", "b"],
    });
  });

  it("does not guess when the publish time is unknown", () => {
    expect(select([video("undated", { publishedAt: null })])).toEqual({
      keep: [],
      markConsidered: ["undated"],
    });
  });

  it("keeps at most the limit, newest first, and remembers the rest as skipped", () => {
    const videos = Array.from({ length: 8 }, (_, i) => video(`v${i}`, { publishedAt: SINCE + i }));
    const { keep, markConsidered } = select(videos);
    expect(keep).toEqual(["v7", "v6", "v5", "v4", "v3"]);
    expect([...markConsidered].sort()).toEqual(videos.map((v) => v.videoId).sort());
  });

  it("never keeps Shorts", () => {
    expect(select([video("short", { isShort: true })])).toEqual({
      keep: [],
      markConsidered: ["short"],
    });
  });

  it("leaves live streams and premieres that have not aired for a later check", () => {
    const videos = [
      video("upcoming", { liveStatus: "is_upcoming" }),
      video("live", { liveStatus: "is_live" }),
    ];
    expect(select(videos)).toEqual({ keep: [], markConsidered: [] });
  });

  it("keeps a live stream once it has aired", () => {
    expect(select([video("aired", { liveStatus: "was_live" })]).keep).toEqual(["aired"]);
  });

  it("never looks at a Video it already considered", () => {
    expect(select([video("seen"), video("new")], ["seen"])).toEqual({
      keep: ["new"],
      markConsidered: ["new"],
    });
  });

  it("does not let skipped Videos use up the limit", () => {
    const videos = [
      ...Array.from({ length: 5 }, (_, i) => video(`short${i}`, { isShort: true })),
      video("new"),
    ];
    expect(select(videos).keep).toEqual(["new"]);
  });
});
