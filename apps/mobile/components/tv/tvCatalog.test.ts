import type {
  Episode,
  Movie,
  MovieWatch,
  Series,
} from "../../../shared/mobile-sync-contract";
import type { HeldTitle } from "../../services/held-movies/types";
import type { StreamingVideo } from "../../stores/playback";
import type {
  TVRecentMovie,
  TVRecentPlaylist,
  TVRecentSeries,
} from "../../stores/tvHistory";
import {
  buildTVCatalog,
  SENT_TO_THIS_TV_ID,
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
  kind: "videos",
  playlistId,
  title: `History ${playlistId}`,
  videos: videoIds.map((id) => video(id)),
  lastIndex: lastVideoId ? videoIds.indexOf(lastVideoId) : 0,
  lastVideoId,
  updatedAt: 0,
});

const movie = (id: string, overrides: Partial<Movie> = {}): Movie => ({
  id,
  title: `Movie ${id}`,
  posterUrl: `/api/movie/${id}/poster`,
  durationSeconds: 6000,
  missing: false,
  captions: [],
  sentToDevices: false,
  watch: null,
  ...overrides,
});

const heldMovie = (id: string): HeldTitle => ({
  kind: "movie",
  id,
  title: `Held ${id}`,
  posterUrl: null,
  durationSeconds: 6000,
});

const movieEntry = (movieId: string): TVRecentMovie => ({
  kind: "movie",
  movieId,
  title: `Saved title ${movieId}`,
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
    movies: [],
    keptMovieWatch: () => undefined,
    series: [],
    keptEpisodeWatch: () => undefined,
    heldTitles: [],
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
        subtitle: "10 videos",
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

  it('puts "Sent to this TV" first in My Lists when the On-device set isn\'t empty', () => {
    const setVideos = [
      { ...video("s1"), thumbnailUrl: null },
      { ...video("s2"), thumbnailUrl: null },
    ];

    const whileConnected = buildTVCatalog(
      input({ ...connected, onDeviceSet: setVideos }),
    );
    expect(whileConnected.tabs.mylists.map((card) => card.id)).toEqual([
      SENT_TO_THIS_TV_ID,
      "ml1",
    ]);
    expect(whileConnected.tabs.mylists[0]).toEqual(
      expect.objectContaining({
        title: "Sent to this TV",
        subtitle: "2 videos",
      }),
    );

    const offline = buildTVCatalog(
      input({
        onDeviceSet: setVideos,
        library: [video("s2")],
        cached: [collection("mylist_held", "mylist", ["s2"])],
      }),
    );
    expect(offline.tabs.mylists.map((card) => card.id)).toEqual([
      SENT_TO_THIS_TV_ID,
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

  it("counts the Videos on this TV beside each card's total while connected", () => {
    const catalog = buildTVCatalog(
      input({
        ...connected,
        library: [video("a", "Remote channel"), video("b", "Remote channel")],
        cached: [
          collection("playlist_pl1", "playlist", ["a", "b", "x"]),
          collection("mylist_ml1", "mylist", ["a", "y"]),
        ],
        onDeviceSet: [
          { ...video("a"), thumbnailUrl: null },
          { ...video("z"), thumbnailUrl: null },
        ],
      }),
    );

    expect(catalog.tabs.playlists[0].subtitle).toBe("10 videos · 2 on this TV");
    expect(catalog.tabs.mylists.map((card) => card.subtitle)).toEqual([
      "2 videos · 1 on this TV",
      "3 videos · 1 on this TV",
    ]);
    expect(catalog.tabs.channels[0].subtitle).toBe("7 videos · 2 on this TV");
  });

  it("leaves out a playlist's total when the desktop doesn't know it", () => {
    const catalog = buildTVCatalog(
      input({
        ...connected,
        remote: {
          ...connected.remote,
          playlists: [{ ...connected.remote.playlists[0], itemCount: null }],
        },
      }),
    );

    expect(catalog.tabs.playlists[0].subtitle).toBe("");
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

  describe("Movies", () => {
    it("lists the desktop's Movies that can play, each pressed to play it", () => {
      const catalog = buildTVCatalog(
        input({
          ...connected,
          movies: [movie("m1"), movie("gone", { missing: true })],
        }),
      );

      expect(catalog.tabs.movies).toEqual([
        {
          id: "movie:m1",
          title: "Movie m1",
          subtitle: "1 h 40 min",
          thumbnailUrl: "/api/movie/m1/poster",
          action: { kind: "movie", movieId: "m1", title: "Movie m1" },
        },
      ]);
      expect(catalog.modes).toContain("movies");
    });

    it("says where a Movie resumes, or that it was watched", () => {
      const kept: Record<string, MovieWatch> = {
        here: {
          kind: "movie",
          id: "here",
          lastPositionSeconds: 2832,
          lastWatchedAt: 20,
        },
      };
      const catalog = buildTVCatalog(
        input({
          ...connected,
          movies: [
            movie("desk", {
              watch: { positionSeconds: 754, watched: false, updatedAt: 10 },
            }),
            movie("here", {
              watch: { positionSeconds: 100, watched: false, updatedAt: 10 },
            }),
            movie("done", {
              watch: { positionSeconds: 0, watched: true, updatedAt: 10 },
            }),
            movie("unknown", { durationSeconds: null }),
          ],
          keptMovieWatch: (id) => kept[id],
        }),
      );

      expect(catalog.tabs.movies.map((card) => card.subtitle)).toEqual([
        "Resume at 12:34",
        "Resume at 47:12",
        "Watched",
        "",
      ]);
    });

    it("hides the Movies tab when there are none, as on an older desktop", () => {
      const catalog = buildTVCatalog(input(connected));

      expect(catalog.tabs.movies).toEqual([]);
      expect(catalog.modes).toEqual([
        "playlists",
        "mylists",
        "channels",
        "history",
      ]);
    });

    it("shows only the Movies the TV holds in Offline mode", () => {
      const catalog = buildTVCatalog(
        input({
          movies: [movie("m1"), movie("m2", { title: "The Matrix" })],
          heldTitles: [heldMovie("m2")],
        }),
      );

      expect(catalog.tabs.movies).toEqual([
        {
          id: "movie:m2",
          title: "The Matrix",
          subtitle: "1 h 40 min",
          thumbnailUrl: null,
          action: { kind: "movie", movieId: "m2", title: "The Matrix" },
        },
      ]);
      expect(catalog.modes).toContain("movies");
    });

    it("hides the Movies tab in Offline mode when the TV holds none", () => {
      const catalog = buildTVCatalog(
        input({ movies: [movie("m1")], library: [video("a")] }),
      );

      expect(catalog.tabs.movies).toEqual([]);
      expect(catalog.modes).not.toContain("movies");
    });

    it("shows a held Movie the saved catalog doesn't list, as the TV holds it", () => {
      const catalog = buildTVCatalog(
        input({
          heldTitles: [
            { ...heldMovie("m9"), title: "Alien", durationSeconds: 3600 },
          ],
        }),
      );

      expect(catalog.tabs.movies).toEqual([
        {
          id: "movie:m9",
          title: "Alien",
          subtitle: "1 h 0 min",
          thumbnailUrl: null,
          action: { kind: "movie", movieId: "m9", title: "Alien" },
        },
      ]);
    });

    it("doesn't say the TV holds nothing when it holds a Movie", () => {
      const catalog = buildTVCatalog(input({ heldTitles: [heldMovie("m1")] }));

      expect(catalog.holdsNothing).toBe(false);
      expect(catalog.emptyText.playlists).toBe("No playlists on this TV");
    });

    it("resumes a held Movie from History in Offline mode", () => {
      const catalog = buildTVCatalog(
        input({
          movies: [movie("m1", { title: "The Matrix" })],
          heldTitles: [heldMovie("m1")],
          history: [movieEntry("m1"), movieEntry("m2")],
        }),
      );

      expect(catalog.tabs.history.map((card) => card.id)).toEqual(["movie:m1"]);
    });

    it("resumes a Movie from History as the desktop lists it now", () => {
      const catalog = buildTVCatalog(
        input({
          ...connected,
          movies: [
            movie("m1", {
              title: "The Matrix",
              watch: { positionSeconds: 754, watched: false, updatedAt: 10 },
            }),
          ],
          history: [movieEntry("m1"), historyEntry("q", ["a"])],
        }),
      );

      expect(catalog.tabs.history[0]).toEqual({
        id: "movie:m1",
        title: "The Matrix",
        subtitle: "Movie · Resume at 12:34",
        thumbnailUrl: "/api/movie/m1/poster",
        action: { kind: "movie", movieId: "m1", title: "The Matrix" },
      });
      expect(catalog.tabs.history.map((card) => card.id)).toEqual([
        "movie:m1",
        "q",
      ]);
    });

    it("leaves out History Movies the desktop no longer shows or can't play", () => {
      const history = [movieEntry("hidden"), movieEntry("gone")];

      const whileConnected = buildTVCatalog(
        input({
          ...connected,
          movies: [movie("gone", { missing: true })],
          history,
        }),
      );
      expect(whileConnected.tabs.history).toEqual([]);

      const offline = buildTVCatalog(
        input({ movies: [movie("hidden")], history }),
      );
      expect(offline.tabs.history).toEqual([]);
    });
  });
});

describe("Series", () => {
  const episode = (id: string, overrides: Partial<Episode> = {}): Episode => ({
    id,
    title: `Episode ${id}`,
    number: null,
    durationSeconds: 3000,
    missing: false,
    captions: [],
    watch: null,
    ...overrides,
  });

  const series = (id: string, episodes: Episode[]): Series => ({
    id,
    title: `Series ${id}`,
    posterUrl: `/api/series/${id}/poster`,
    seasons: [
      {
        id: `${id}-s1`,
        title: "Season 1",
        number: 1,
        sentToDevices: false,
        episodes,
      },
    ],
  });

  const seriesEntry = (seriesId: string): TVRecentSeries => ({
    kind: "series",
    seriesId,
    title: `Saved title ${seriesId}`,
    updatedAt: 0,
  });

  const watched = { positionSeconds: 0, watched: true, updatedAt: 10 };

  it("lists the desktop's Series with an Episode that plays, each pressed to open it", () => {
    const catalog = buildTVCatalog(
      input({
        ...connected,
        series: [
          series("s1", [episode("e1"), episode("e2")]),
          series("gone", [episode("g1", { missing: true })]),
        ],
      }),
    );

    expect(catalog.tabs.series).toEqual([
      {
        id: "series:s1",
        title: "Series s1",
        subtitle: "2 Episodes",
        thumbnailUrl: "/api/series/s1/poster",
        action: { kind: "series", seriesId: "s1", title: "Series s1" },
      },
    ]);
    expect(catalog.modes).toEqual([
      "playlists",
      "mylists",
      "channels",
      "series",
      "history",
    ]);
  });

  it("says where a Series picks up, or that it was watched", () => {
    const kept: Record<string, MovieWatch> = {
      here: {
        kind: "episode",
        id: "here",
        lastPositionSeconds: 754,
        lastWatchedAt: 20,
      },
    };
    const catalog = buildTVCatalog(
      input({
        ...connected,
        series: [
          series("resume", [
            episode("done", { watch: watched }),
            episode("here"),
          ]),
          series("next", [episode("n1", { watch: watched }), episode("n2")]),
          series("all", [episode("a1", { watch: watched })]),
        ],
        keptEpisodeWatch: (id) => kept[id],
      }),
    );

    expect(catalog.tabs.series.map((card) => card.subtitle)).toEqual([
      "Resume Episode here at 12:34",
      "Next: Episode n2",
      "Watched",
    ]);
  });

  const heldEpisode = (id: string): HeldTitle => ({
    kind: "episode",
    id,
    title: `Held ${id}`,
    posterUrl: null,
    durationSeconds: 3000,
  });

  it("hides the Series tab when there are none, and offline when the TV holds no Episode", () => {
    expect(buildTVCatalog(input(connected)).modes).not.toContain("series");

    const offline = buildTVCatalog(
      input({ series: [series("s1", [episode("e1")])], library: [video("a")] }),
    );
    expect(offline.tabs.series).toEqual([]);
    expect(offline.modes).not.toContain("series");
  });

  it("shows Series with an Episode the TV holds in Offline mode, counting only those", () => {
    const catalog = buildTVCatalog(
      input({
        series: [
          series("s1", [episode("e1"), episode("e2"), episode("e3")]),
          series("s2", [episode("x1")]),
        ],
        heldTitles: [heldEpisode("e1"), heldEpisode("e3")],
      }),
    );

    expect(catalog.tabs.series).toEqual([
      {
        id: "series:s1",
        title: "Series s1",
        subtitle: "2 Episodes",
        thumbnailUrl: null,
        action: { kind: "series", seriesId: "s1", title: "Series s1" },
      },
    ]);
    expect(catalog.modes).toContain("series");
  });

  it("plays a held Episode offline even when the desktop lost its file", () => {
    const catalog = buildTVCatalog(
      input({
        series: [series("s1", [episode("e1", { missing: true })])],
        heldTitles: [heldEpisode("e1")],
      }),
    );

    expect(catalog.tabs.series.map((card) => card.subtitle)).toEqual([
      "1 Episode",
    ]);
  });

  it("resumes a Series from History offline at the next Episode the TV holds", () => {
    const catalog = buildTVCatalog(
      input({
        series: [
          series("s1", [
            episode("e1", { watch: watched }),
            episode("e2"),
            episode("e3"),
          ]),
        ],
        heldTitles: [heldEpisode("e1"), heldEpisode("e3")],
        history: [seriesEntry("s1")],
      }),
    );

    expect(catalog.tabs.history[0]).toMatchObject({
      subtitle: "Series · Next: Episode e3",
      action: { kind: "episode", episodeId: "e3", title: "Series s1" },
    });
  });

  it("resumes a Series from History at its Episode in progress", () => {
    const catalog = buildTVCatalog(
      input({
        ...connected,
        series: [
          series("s1", [
            episode("e1", { watch: watched }),
            episode("e2", {
              watch: { positionSeconds: 754, watched: false, updatedAt: 12 },
            }),
            episode("e3"),
          ]),
        ],
        history: [seriesEntry("s1"), historyEntry("q", ["a"])],
      }),
    );

    expect(catalog.tabs.history[0]).toEqual({
      id: "series:s1",
      title: "Series s1",
      subtitle: "Series · Resume Episode e2 at 12:34",
      thumbnailUrl: "/api/series/s1/poster",
      action: { kind: "episode", episodeId: "e2", title: "Series s1" },
    });
    expect(catalog.tabs.history.map((card) => card.id)).toEqual([
      "series:s1",
      "q",
    ]);
  });

  it("resumes a Series from History at the next unwatched Episode", () => {
    const catalog = buildTVCatalog(
      input({
        ...connected,
        series: [
          series("s1", [
            episode("e1", { watch: watched }),
            episode("e2", { missing: true }),
            episode("e3"),
          ]),
        ],
        history: [seriesEntry("s1")],
      }),
    );

    expect(catalog.tabs.history[0].action).toEqual({
      kind: "episode",
      episodeId: "e3",
      title: "Series s1",
    });
  });

  it("opens a watched Series from History instead of playing it", () => {
    const catalog = buildTVCatalog(
      input({
        ...connected,
        series: [series("s1", [episode("e1", { watch: watched })])],
        history: [seriesEntry("s1")],
      }),
    );

    expect(catalog.tabs.history[0]).toMatchObject({
      subtitle: "Series · Watched",
      action: { kind: "series", seriesId: "s1", title: "Series s1" },
    });
  });

  it("leaves out History Series the desktop no longer shows, and offline those the TV holds nothing of", () => {
    const shown = [series("s1", [episode("e1")])];

    const whileConnected = buildTVCatalog(
      input({ ...connected, series: shown, history: [seriesEntry("hidden")] }),
    );
    expect(whileConnected.tabs.history).toEqual([]);

    const offline = buildTVCatalog(
      input({ series: shown, history: [seriesEntry("s1")] }),
    );
    expect(offline.tabs.history).toEqual([]);
  });
});
