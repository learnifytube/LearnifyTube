import type { RemotePlaylist } from "../../types";
import {
  buildTVChannelView,
  heldChannelContents,
  heldPlaylistVideos,
  type ChannelVideo,
  type SavedCollectionItems,
  type SavedCollectionSummary,
  type TVChannelViewInput,
} from "./tvChannel";

const SERVER = "http://desktop.local:53318";

const video = (id: string, channelTitle = "Channel"): ChannelVideo => ({
  id,
  title: `Video ${id}`,
  channelTitle,
  duration: 60,
  thumbnailUrl: `/thumbs/${id}.jpg`,
});

const playlist = (playlistId: string, downloadedCount = 1): RemotePlaylist => ({
  playlistId,
  title: `Playlist ${playlistId}`,
  thumbnailUrl: null,
  itemCount: 3,
  channelId: "ch1",
  type: "channel",
  downloadedCount,
});

const desktop = {
  url: SERVER,
  resolveAssetUrl: (assetUrl?: string | null) =>
    assetUrl ? `${SERVER}${assetUrl}` : null,
  playlistThumbnailUrl: (playlistId: string) =>
    `${SERVER}/api/playlist/${playlistId}/thumbnail`,
  videoThumbnailUrl: (videoId: string) =>
    `${SERVER}/api/video/${videoId}/thumbnail`,
};

function input(
  overrides: Partial<TVChannelViewInput> & { held?: string[] } = {},
): TVChannelViewInput {
  const held = new Set(overrides.held ?? []);
  return {
    channel: { id: "ch1", title: "Channel" },
    contents: { from: "desktop", playlists: [], videos: [] },
    open: null,
    desktop,
    hasOfflineCopy: (videoId) => held.has(videoId),
    getStoredThumbnail: () => null,
    ...overrides,
  };
}

describe("TV channel view", () => {
  it("shows the channel's playlists, each opening its playlist", () => {
    const view = buildTVChannelView(
      input({
        contents: {
          from: "desktop",
          playlists: [playlist("pl1", 2)],
          videos: [video("a")],
        },
      }),
    );

    expect(view.cards).toEqual([
      {
        id: "pl1",
        title: "Playlist pl1",
        subtitle: "2 ready",
        thumbnailUrl: `${SERVER}/api/playlist/pl1/thumbnail`,
        action: {
          kind: "openPlaylist",
          playlistId: "pl1",
          title: "Playlist pl1",
        },
      },
    ]);
  });

  it("streams the channel's Videos from the desktop when it has no playlists", () => {
    const view = buildTVChannelView(
      input({
        contents: {
          from: "desktop",
          playlists: [],
          videos: [video("a"), video("b")],
        },
        held: ["b"],
      }),
    );

    expect(view.cards.map((card) => card.id)).toEqual(["a", "b"]);
    expect(view.cards[1].thumbnailUrl).toBe(`${SERVER}/thumbs/b.jpg`);
    expect(view.cards[1].action).toEqual({
      kind: "play",
      queue: {
        id: "channel-ch1",
        title: "Channel",
        videos: [
          expect.objectContaining({ id: "a" }),
          expect.objectContaining({ id: "b" }),
        ],
        startIndex: 1,
      },
    });
  });

  it("shows and plays only held Videos when showing what the TV holds", () => {
    const view = buildTVChannelView(
      input({
        contents: {
          from: "held",
          playlists: [],
          videos: [video("a"), video("b"), video("c")],
        },
        held: ["a", "c"],
        getStoredThumbnail: (videoId) => `file:///thumbs/${videoId}.jpg`,
      }),
    );

    expect(view.cards.map((card) => card.id)).toEqual(["a", "c"]);
    expect(view.cards[1].thumbnailUrl).toBe("file:///thumbs/c.jpg");
    expect(view.cards[1].action).toEqual({
      kind: "play",
      queue: expect.objectContaining({
        videos: [
          expect.objectContaining({
            id: "a",
            thumbnailUrl: "file:///thumbs/a.jpg",
          }),
          expect.objectContaining({ id: "c" }),
        ],
        startIndex: 1,
      }),
    });
    expect(view.emptyText).toBe("Nothing from this channel is on this TV.");
  });

  it("falls back to held Videos once the desktop is gone", () => {
    const view = buildTVChannelView(
      input({
        contents: {
          from: "desktop",
          playlists: [],
          videos: [video("a"), video("b")],
        },
        desktop: null,
        held: ["b"],
      }),
    );

    expect(view.cards.map((card) => card.id)).toEqual(["b"]);
    expect(view.cards[0].thumbnailUrl).toBe("/thumbs/b.jpg");
    expect(view.cards[0].action).toEqual({
      kind: "play",
      queue: expect.objectContaining({
        videos: [expect.objectContaining({ id: "b" })],
        startIndex: 0,
      }),
    });
  });

  it("drops a Video whose Offline copy is gone", () => {
    const contents = {
      from: "held" as const,
      playlists: [],
      videos: [video("a"), video("b")],
    };

    expect(
      buildTVChannelView(input({ contents, held: ["a"] })).cards.map(
        (card) => card.id,
      ),
    ).toEqual(["a"]);
  });

  it("shows an open playlist's Videos and plays it as its own queue", () => {
    const view = buildTVChannelView(
      input({
        contents: {
          from: "desktop",
          playlists: [playlist("pl1")],
          videos: [],
        },
        open: {
          id: "pl1",
          title: "Playlist pl1",
          from: "desktop",
          videos: [video("x"), video("y")],
        },
      }),
    );

    expect(view.cards.map((card) => card.id)).toEqual(["x", "y"]);
    expect(view.cards[0].action).toEqual({
      kind: "play",
      queue: expect.objectContaining({
        id: "playlist-pl1",
        title: "Playlist pl1",
        startIndex: 0,
      }),
    });
    expect(view.emptyText).toBe("No videos in this playlist");
  });

  it("plays only the held Videos of a playlist opened from what the TV holds", () => {
    const view = buildTVChannelView(
      input({
        open: {
          id: "pl1",
          title: "Playlist pl1",
          from: "held",
          videos: [video("x"), video("y")],
        },
        held: ["y"],
      }),
    );

    expect(view.cards.map((card) => card.id)).toEqual(["y"]);
  });

  it("says when the desktop's channel is empty", () => {
    expect(buildTVChannelView(input()).emptyText).toBe(
      "No playlists or videos",
    );
  });
});

describe("What the TV holds from a channel", () => {
  const summary = (
    overrides: Partial<SavedCollectionSummary>,
  ): SavedCollectionSummary => ({
    id: "playlist_pl1",
    type: "playlist",
    title: "Playlist pl1",
    sourceId: "ch1",
    thumbnailUrl: null,
    downloadedCount: 1,
    totalCount: 3,
    ...overrides,
  });

  const items = (videoIds: string[]): SavedCollectionItems => ({
    items: videoIds.map((id) => ({
      videoId: id,
      title: `Video ${id}`,
      channelTitle: "Channel",
      duration: 60,
      thumbnailUrl: null,
    })),
  });

  it("holds the channel's playlists with a held Video and its held Videos", () => {
    const saved = [
      summary({ id: "channel_ch1", type: "channel", title: "Channel" }),
      summary({ id: "playlist_pl1", downloadedCount: 2 }),
      summary({ id: "playlist_pl2", downloadedCount: 0 }),
      summary({ id: "playlist_other", sourceId: "ch2" }),
    ];
    const held = new Set(["a", "c", "lib"]);

    const contents = heldChannelContents({
      channel: { id: "ch1", title: "Channel" },
      saved,
      getSavedPlaylist: (id) =>
        id === "channel_ch1" ? items(["a", "b", "c"]) : undefined,
      library: [video("lib"), video("c"), video("elsewhere", "Other")],
      hasOfflineCopy: (videoId) => held.has(videoId),
    });

    expect(contents.from).toBe("held");
    expect(contents.known).toBe(true);
    expect(contents.playlists).toEqual([
      expect.objectContaining({ playlistId: "pl1", downloadedCount: 2 }),
    ]);
    expect(contents.videos.map((item) => item.id)).toEqual(["a", "c", "lib"]);
  });

  it("finds the channel by title when it has no id", () => {
    const contents = heldChannelContents({
      channel: { title: "Channel" },
      saved: [summary({ id: "channel_x", type: "channel", title: "Channel" })],
      getSavedPlaylist: () => items([]),
      library: [],
      hasOfflineCopy: () => false,
    });

    expect(contents.known).toBe(true);
    expect(contents.videos).toEqual([]);
  });

  it("knows nothing of a channel never loaded", () => {
    const contents = heldChannelContents({
      channel: { id: "ch1", title: "Channel" },
      saved: [],
      getSavedPlaylist: () => undefined,
      library: [],
      hasOfflineCopy: () => false,
    });

    expect(contents.known).toBe(false);
  });

  it("lists a cached playlist's held Videos", () => {
    expect(
      heldPlaylistVideos(items(["a", "b"]), (videoId) => videoId === "b").map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
  });
});
