import type {
  Episode,
  Movie,
  MovieWatch,
  Series,
} from "../../../shared/mobile-sync-contract";
import type { StreamingVideo } from "../../stores/playback";
import {
  mergeContinueWatching,
  type ContinueWatchingInput,
} from "./continueWatching";

const video = (id: string): StreamingVideo => ({
  id,
  title: id,
  channelTitle: "Channel",
  duration: 600,
});

const movie = (id: string, overrides: Partial<Movie> = {}): Movie => ({
  id,
  title: id,
  posterUrl: null,
  durationSeconds: 6000,
  missing: false,
  captions: [],
  sentToDevices: false,
  watch: null,
  ...overrides,
});

const episode = (id: string, overrides: Partial<Episode> = {}): Episode => ({
  id,
  title: id,
  number: null,
  durationSeconds: 1000,
  missing: false,
  captions: [],
  watch: null,
  ...overrides,
});

const series = (id: string, episodes: Episode[]): Series => ({
  id,
  title: id,
  posterUrl: null,
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

const onDesktop = (
  positionSeconds: number,
  updatedAt: number,
  watched = false,
) => ({
  watch: { positionSeconds, watched, updatedAt },
});

const base = (
  overrides: Partial<ContinueWatchingInput> = {},
): ContinueWatchingInput => ({
  connected: true,
  videos: [],
  movies: [],
  series: [],
  kept: () => undefined,
  ...overrides,
});

const keptOnPhone =
  (entries: Record<string, [number, number]>) =>
  (kind: MovieWatch["kind"], id: string): MovieWatch | undefined => {
    const entry = entries[`${kind}:${id}`];
    return entry
      ? { kind, id, lastPositionSeconds: entry[0], lastWatchedAt: entry[1] }
      : undefined;
  };

const ids = (input: ContinueWatchingInput) =>
  mergeContinueWatching(input).map((item) =>
    item.kind === "video"
      ? `video:${item.video.id}`
      : item.kind === "movie"
        ? `movie:${item.movie.id}`
        : `episode:${item.episode.id}`,
  );

describe("Continue watching", () => {
  it("is empty when nothing was started", () => {
    expect(
      ids(
        base({
          movies: [movie("up")],
          series: [series("office", [episode("e1")])],
        }),
      ),
    ).toEqual([]);
  });

  it("merges Videos, Movies in progress and each Series' next Episode, newest first", () => {
    expect(
      ids(
        base({
          videos: [
            { video: video("v1"), lastWatchedAt: 40 },
            { video: video("v2"), lastWatchedAt: 10 },
          ],
          movies: [movie("up", onDesktop(1200, 30)), movie("alien")],
          series: [
            series("office", [
              episode("o1", onDesktop(1000, 20, true)),
              episode("o2"),
            ]),
          ],
          kept: keptOnPhone({ "movie:alien": [600, 50] }),
        }),
      ),
    ).toEqual([
      "movie:alien",
      "video:v1",
      "movie:up",
      "episode:o2",
      "video:v2",
    ]);
  });

  it("keeps each Video's place in the Video queue the row plays", () => {
    const items = mergeContinueWatching(
      base({
        videos: [
          { video: video("v1"), lastWatchedAt: 40 },
          { video: video("v2"), lastWatchedAt: 10 },
        ],
        movies: [movie("up", onDesktop(1200, 30))],
      }),
    );
    expect(
      items.flatMap((item) => (item.kind === "video" ? [item.videoIndex] : [])),
    ).toEqual([0, 1]);
  });

  it("leaves out Movies watched to the end, on the desktop or this phone", () => {
    expect(
      ids(
        base({
          movies: [
            movie("up", onDesktop(0, 30, true)),
            movie("alien"),
            movie("jaws", onDesktop(2000, 10)),
          ],
          kept: keptOnPhone({ "movie:alien": [5800, 50] }),
        }),
      ),
    ).toEqual(["movie:jaws"]);
  });

  it("follows a desktop mark made after this phone last played", () => {
    expect(
      ids(
        base({
          movies: [movie("up", onDesktop(0, 70))],
          series: [series("office", [episode("o1", onDesktop(0, 70, true))])],
          kept: keptOnPhone({
            "movie:up": [1200, 60],
            "episode:o1": [300, 60],
          }),
        }),
      ),
    ).toEqual([]);
  });

  it("shows the Series' Episode in progress, dated by its latest Episode", () => {
    const [item] = mergeContinueWatching(
      base({
        series: [
          series("office", [
            episode("o1", onDesktop(1000, 20, true)),
            episode("o2"),
            episode("o3"),
          ]),
        ],
        kept: keptOnPhone({ "episode:o2": [300, 60] }),
      }),
    );
    expect(item).toMatchObject({
      kind: "episode",
      episode: { id: "o2" },
      series: { id: "office" },
      lastWatchedAt: 60,
    });
  });

  it("shows the Episode this phone went back to, not the later one in progress", () => {
    const [item] = mergeContinueWatching(
      base({
        series: [
          {
            ...series("office", [
              episode("o1", onDesktop(300, 20)),
              episode("o2"),
              episode("o3", onDesktop(300, 30)),
            ]),
            lastEpisode: { episodeId: "o3", updatedAt: 30 },
          },
        ],
        kept: keptOnPhone({ "episode:o1": [400, 60] }),
        keptLastEpisode: (seriesId) =>
          seriesId === "office"
            ? { seriesId, episodeId: "o1", updatedAt: 60 }
            : undefined,
      }),
    );
    expect(item).toMatchObject({ kind: "episode", episode: { id: "o1" } });
  });

  it("drops a Series once no unwatched Episode remains", () => {
    expect(
      ids(
        base({
          series: [
            series("office", [
              episode("o1", onDesktop(1000, 20, true)),
              episode("o2", { missing: true }),
            ]),
          ],
          kept: keptOnPhone({}),
        }),
      ),
    ).toEqual([]);
  });

  it("leaves out Movies whose file is missing", () => {
    expect(
      ids(
        base({
          movies: [movie("up", { missing: true, ...onDesktop(1200, 30) })],
        }),
      ),
    ).toEqual([]);
  });

  it("dims Movies and Episodes in Offline mode: they need the desktop", () => {
    const items = mergeContinueWatching(
      base({
        connected: false,
        movies: [movie("up", onDesktop(1200, 30))],
        series: [series("office", [episode("o1", onDesktop(300, 20))])],
      }),
    );
    expect(
      items.map((item) => item.kind !== "video" && item.needsDesktop),
    ).toEqual([true, true]);
  });

  it("plays a Movie or Episode with an Offline copy in Offline mode", () => {
    const items = mergeContinueWatching({
      ...base({
        connected: false,
        movies: [movie("up", onDesktop(1200, 30))],
        series: [series("office", [episode("o1", onDesktop(300, 20))])],
      }),
      onThisPhone: (id) => id === "up" || id === "o1",
    });
    expect(
      items.map((item) => item.kind !== "video" && item.needsDesktop),
    ).toEqual([false, false]);
  });
});
