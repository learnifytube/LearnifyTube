import { selectLibraryVideos, type LibraryVideo, type LibraryView } from "./library-view";

const video = (overrides: Partial<LibraryVideo>): LibraryVideo => ({
  videoId: "v",
  title: "Title",
  channelId: "c1",
  channelTitle: "Channel One",
  durationSeconds: 60,
  keptAt: 1,
  watchState: "unwatched",
  listIds: [],
  ...overrides,
});

const view = (overrides: Partial<LibraryView> = {}): LibraryView => ({
  search: "",
  sort: "recently-kept",
  watchState: "all",
  channelId: "all",
  listId: "all",
  ...overrides,
});

const ids = (videos: LibraryVideo[]) => videos.map((v) => v.videoId);

describe("selectLibraryVideos", () => {
  const videos = [
    video({ videoId: "old", title: "Banana", keptAt: 100, durationSeconds: 300 }),
    video({
      videoId: "new",
      title: "apple",
      keptAt: 300,
      durationSeconds: 30,
      channelId: "c2",
      channelTitle: "Zed",
    }),
    video({
      videoId: "mid",
      title: "Cherry",
      keptAt: 200,
      durationSeconds: null,
      watchState: "watched",
      listIds: ["l1"],
    }),
  ];

  it("puts the Video kept most recently first by default", () => {
    expect(ids(selectLibraryVideos(videos, view()))).toEqual(["new", "mid", "old"]);
  });

  it("sorts by title ignoring case", () => {
    expect(ids(selectLibraryVideos(videos, view({ sort: "title" })))).toEqual([
      "new",
      "old",
      "mid",
    ]);
  });

  it("sorts by duration, longest first, unknown last", () => {
    expect(ids(selectLibraryVideos(videos, view({ sort: "duration" })))).toEqual([
      "old",
      "new",
      "mid",
    ]);
  });

  it("sorts by channel then most recently kept", () => {
    expect(ids(selectLibraryVideos(videos, view({ sort: "channel" })))).toEqual([
      "mid",
      "old",
      "new",
    ]);
  });

  it("searches title and channel", () => {
    expect(ids(selectLibraryVideos(videos, view({ search: "APP" })))).toEqual(["new"]);
    expect(ids(selectLibraryVideos(videos, view({ search: "zed" })))).toEqual(["new"]);
  });

  it("filters by Watch state, Channel and List", () => {
    expect(ids(selectLibraryVideos(videos, view({ watchState: "watched" })))).toEqual(["mid"]);
    expect(ids(selectLibraryVideos(videos, view({ channelId: "c2" })))).toEqual(["new"]);
    expect(ids(selectLibraryVideos(videos, view({ listId: "l1" })))).toEqual(["mid"]);
  });
});
