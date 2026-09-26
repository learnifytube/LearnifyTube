import { selectUpNext, type UpNextVideo } from "./up-next";

const video = (overrides: Partial<UpNextVideo>): UpNextVideo => ({
  videoId: "v",
  keptAt: 1,
  lastWatchedAt: null,
  watchState: "unwatched",
  ...overrides,
});

const ids = (videos: UpNextVideo[]) => videos.map((v) => v.videoId);

describe("selectUpNext", () => {
  const videos = [
    video({ videoId: "old-unwatched", keptAt: 100 }),
    video({ videoId: "new-unwatched", keptAt: 300 }),
    video({
      videoId: "played-long-ago",
      keptAt: 400,
      watchState: "in-progress",
      lastWatchedAt: 10,
    }),
    video({
      videoId: "played-just-now",
      keptAt: 50,
      watchState: "in-progress",
      lastWatchedAt: 90,
    }),
    video({ videoId: "done", keptAt: 500, watchState: "watched", lastWatchedAt: 99 }),
  ];

  it("puts in-progress Videos in Continue watching, most recently played first", () => {
    expect(ids(selectUpNext(videos).continueWatching)).toEqual([
      "played-just-now",
      "played-long-ago",
    ]);
  });

  it("puts unwatched Videos in Unwatched, newest kept first", () => {
    expect(ids(selectUpNext(videos).unwatched)).toEqual(["new-unwatched", "old-unwatched"]);
  });

  it("leaves watched Videos out of both sections", () => {
    const { continueWatching, unwatched } = selectUpNext(videos);
    expect([...ids(continueWatching), ...ids(unwatched)]).not.toContain("done");
  });

  it("sorts in-progress Videos never played on this desktop by when they were kept", () => {
    const { continueWatching } = selectUpNext([
      video({ videoId: "phone-older", watchState: "in-progress", keptAt: 1 }),
      video({ videoId: "desk", watchState: "in-progress", lastWatchedAt: 5 }),
      video({ videoId: "phone-newer", watchState: "in-progress", keptAt: 2 }),
    ]);
    expect(ids(continueWatching)).toEqual(["desk", "phone-newer", "phone-older"]);
  });
});
