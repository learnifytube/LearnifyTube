import type { StreamingVideo } from "../../stores/playback";
import type { TVRecentPlaylist } from "../../stores/tvHistory";
import {
  buildTVCatalog,
  ON_THIS_TV_ID,
  type CachedCollection,
  type TVCatalogInput,
} from "./tvCatalog";

const SERVER = "http://desktop.local:53318";

const video = (id: string, channelTitle = "Channel"): StreamingVideo => ({
  id,
  title: `Video ${id}`,
  channelTitle,
  duration: 60,
});

const collection = (
  id: string,
  type: CachedCollection["type"],
  videoIds: string[],
): CachedCollection => ({
  id,
  type,
  title: `Collection ${id}`,
  sourceId: null,
  thumbnailUrl: null,
  items: videoIds.map((videoId) => video(videoId)),
});

const historyEntry = (
  playlistId: string,
  videoIds: string[],
  lastVideoId: string | null = null,
): TVRecentPlaylist => ({
  playlistId,
  title: `History ${playlistId}`,
  videos: videoIds.map((id) => video(id)),
  lastIndex: lastVideoId ? videoIds.indexOf(lastVideoId) : 0,
  lastVideoId,
  updatedAt: 0,
});

function input(overrides: Partial<TVCatalogInput> = {}): TVCatalogInput {
  const held = new Set(overrides.library?.map((item) => item.id) ?? []);
  return {
    desktop: null,
    remote: { playlists: [], myLists: [], channels: [] },
    cached: [],
    library: [],
    hasOfflineCopy: (videoId) => held.has(videoId),
    getStoredThumbnail: () => null,
    onDeviceSet: [],
    history: [],
    ...overrides,
  };
}

const connected = {
  desktop: {
    url: SERVER,
    resolveAssetUrl: (assetUrl?: string | null) => assetUrl ?? null,
    playlistThumbnailUrl: (playlistId: string) =>
      `${SERVER}/api/playlist/${playlistId}/thumbnail`,
  },
  remote: {
    playlists: [
      {
        playlistId: "pl1",
        title: "Remote playlist",
        thumbnailUrl: null,
        itemCount: 10,
        channelId: null,
        type: "custom" as const,
        downloadedCount: 4,
      },
    ],
    myLists: [
      {
        id: "ml1",
        name: "Remote list",
        itemCount: 3,
        thumbnailUrl: null,
        sourceType: "custom_playlist" as const,
        sourceId: "ml1",
        isFavorite: false,
      },
    ],
    channels: [
      {
        channelId: "ch1",
        channelTitle: "Remote channel",
        thumbnailUrl: null,
        videoCount: 7,
      },
    ],
  },
};

describe("buildTVCatalog", () => {
  it("shows the remote catalog while connected", () => {
    const catalog = buildTVCatalog(
      input({
        ...connected,
        cached: [collection("playlist_cached", "playlist", ["a"])],
      }),
    );

    expect(catalog.tabs.playlists).toEqual([
      expect.objectContaining({
        title: "Remote playlist",
        subtitle: "4 ready",
        action: {
          kind: "remote",
          collection: "playlist",
          id: "pl1",
          title: "Remote playlist",
        },
      }),
    ]);
    expect(catalog.tabs.mylists.map((card) => card.title)).toEqual([
      "Remote list",
    ]);
    expect(catalog.tabs.channels).toEqual([
      expect.objectContaining({
        title: "Remote channel",
        subtitle: "7 videos",
        action: { kind: "channel", id: "ch1", title: "Remote channel" },
      }),
    ]);
  });

  it("shows only what the TV holds as soon as the desktop isn't connected", () => {
    const catalog = buildTVCatalog(
      input({
        remote: connected.remote,
        cached: [
          collection("playlist_held", "playlist", ["a", "b", "c"]),
          collection("playlist_empty", "playlist", ["x", "y"]),
          collection("mylist_empty", "mylist", ["z"]),
        ],
        library: [video("a"), video("c")],
      }),
    );

    expect(catalog.tabs.playlists.map((card) => card.id)).toEqual([
      "playlist_held",
    ]);
    expect(catalog.tabs.mylists).toEqual([]);
  });

  it("opens an Offline collection with only the Videos the TV holds", () => {
    const catalog = buildTVCatalog(
      input({
        cached: [collection("playlist_held", "playlist", ["a", "b", "c"])],
        library: [video("a"), video("c")],
      }),
    );

    const [card] = catalog.tabs.playlists;
    expect(card.subtitle).toBe("2 videos");
    expect(card.action).toEqual({
      kind: "play",
      playlistId: "offline-playlist_held",
      title: "Collection playlist_held",
      videos: [video("a"), video("c")],
      startIndex: 0,
    });
  });

  it('puts "On this TV" first in My Lists when the On-device set isn\'t empty', () => {
    const setVideos = [
      { ...video("s1"), thumbnailUrl: null },
      { ...video("s2"), thumbnailUrl: null },
    ];

    const whileConnected = buildTVCatalog(
      input({ ...connected, onDeviceSet: setVideos }),
    );
    expect(whileConnected.tabs.mylists.map((card) => card.id)).toEqual([
      ON_THIS_TV_ID,
      "ml1",
    ]);
    expect(whileConnected.tabs.mylists[0]).toEqual(
      expect.objectContaining({ title: "On this TV", subtitle: "2 videos" }),
    );

    const offline = buildTVCatalog(
      input({
        onDeviceSet: setVideos,
        library: [video("s2")],
        cached: [collection("mylist_held", "mylist", ["s2"])],
      }),
    );
    expect(offline.tabs.mylists.map((card) => card.id)).toEqual([
      ON_THIS_TV_ID,
      "mylist_held",
    ]);
    expect(offline.tabs.mylists[0]).toEqual(
      expect.objectContaining({
        subtitle: "1 video",
        action: expect.objectContaining({
          kind: "play",
          videos: [expect.objectContaining({ id: "s2" })],
        }),
      }),
    );

    expect(buildTVCatalog(input(connected)).tabs.mylists[0].id).toBe("ml1");
  });

  it("builds Offline Channels from the Videos the TV holds", () => {
    const catalog = buildTVCatalog(
      input({
        cached: [
          {
            ...collection("channel_ch2", "channel", ["x"]),
            title: "Empty channel",
          },
          { ...collection("channel_ch1", "channel", []), title: "Beta" },
        ],
        library: [video("a", "Beta"), video("b", "Alpha"), video("c", "Beta")],
      }),
    );

    expect(
      catalog.tabs.channels.map(({ title, subtitle }) => ({ title, subtitle })),
    ).toEqual([
      { title: "Alpha", subtitle: "1 video" },
      { title: "Beta", subtitle: "2 videos" },
    ]);
  });

  it("keeps only History entries with a playable Video in Offline mode", () => {
    const history = [
      historyEntry("gone", ["x", "y"]),
      historyEntry("partly", ["a", "x", "b"], "b"),
    ];

    const offline = buildTVCatalog(
      input({ history, library: [video("a"), video("b")] }),
    );
    expect(offline.tabs.history).toEqual([
      expect.objectContaining({
        id: "partly",
        subtitle: "Resume 2/2 - Video b",
        action: expect.objectContaining({
          kind: "play",
          videos: [video("a"), video("b")],
          startIndex: 1,
        }),
      }),
    ]);

    const whileConnected = buildTVCatalog(input({ ...connected, history }));
    expect(whileConnected.tabs.history.map((card) => card.id)).toEqual([
      "gone",
      "partly",
    ]);
  });

  it("says the TV holds nothing, and how to get some, in Offline mode", () => {
    const empty = buildTVCatalog(input());
    expect(empty.holdsNothing).toBe(true);
    expect(empty.emptyText.playlists).toBe("Nothing on this TV yet");
    expect(empty.emptyHint).toMatch(/Phone List/);

    const someHeld = buildTVCatalog(input({ library: [video("a")] }));
    expect(someHeld.holdsNothing).toBe(false);
    expect(someHeld.emptyText.playlists).toBe("No playlists on this TV");
    expect(someHeld.emptyHint).toBeNull();
  });
});
