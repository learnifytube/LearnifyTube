import type {
  Episode,
  MovieWatch,
  Season,
  Series,
} from "../../../shared/mobile-sync-contract";
import { buildTVSeriesView } from "./tvSeries";

const episode = (id: string, overrides: Partial<Episode> = {}): Episode => ({
  id,
  title: `Episode ${id}`,
  number: null,
  durationSeconds: 2700,
  missing: false,
  captions: [],
  watch: null,
  ...overrides,
});

const season = (id: string, episodes: Episode[]): Season => ({
  id,
  title: `Season ${id}`,
  number: null,
  sentToDevices: false,
  episodes,
});

const series = (seasons: Season[]): Series => ({
  id: "s",
  title: "Dark",
  posterUrl: "/api/series/s/poster",
  seasons,
});

const watched = { positionSeconds: 0, watched: true, updatedAt: 10 };

describe("buildTVSeriesView", () => {
  it("lists each Season's Episodes, each pressed to play it", () => {
    const view = buildTVSeriesView({
      series: series([
        season("1", [episode("a"), episode("b")]),
        season("2", [episode("c")]),
      ]),
      keptEpisodeWatch: () => undefined,
    });

    expect(view.seasons.map((item) => item.title)).toEqual([
      "Season 1",
      "Season 2",
    ]);
    expect(view.seasons[0].episodes).toEqual([
      {
        id: "a",
        title: "Episode a",
        subtitle: "Up next · 45 min",
        playable: true,
      },
      { id: "b", title: "Episode b", subtitle: "45 min", playable: true },
    ]);
  });

  it("says which Episodes were watched, which are in progress and which can't play", () => {
    const kept: Record<string, MovieWatch> = {
      here: {
        kind: "episode",
        id: "here",
        lastPositionSeconds: 754,
        lastWatchedAt: 20,
      },
    };
    const view = buildTVSeriesView({
      series: series([
        season("1", [
          episode("done", { watch: watched }),
          episode("gone", { missing: true }),
          episode("here"),
          episode("later", { durationSeconds: null }),
        ]),
      ]),
      keptEpisodeWatch: (id) => kept[id],
    });

    expect(view.seasons[0].episodes).toEqual([
      {
        id: "done",
        title: "Episode done",
        subtitle: "Watched",
        playable: true,
      },
      {
        id: "gone",
        title: "Episode gone",
        subtitle: "File missing",
        playable: false,
      },
      {
        id: "here",
        title: "Episode here",
        subtitle: "Up next · Resume at 12:34",
        playable: true,
      },
      { id: "later", title: "Episode later", subtitle: "", playable: true },
    ]);
  });

  it("opens at the next-up Episode, in a later Season too", () => {
    const view = buildTVSeriesView({
      series: series([
        season("1", [episode("a", { watch: watched })]),
        season("2", [episode("b", { watch: watched }), episode("c")]),
      ]),
      keptEpisodeWatch: () => undefined,
    });

    expect(view.focus).toEqual({ seasonIndex: 1, episodeId: "c" });
  });

  it("opens at the Episode this TV went back to, over a later one in progress", () => {
    const inProgress = (updatedAt: number) => ({
      watch: { positionSeconds: 600, watched: false, updatedAt },
    });
    const view = buildTVSeriesView({
      series: {
        ...series([
          season("1", [episode("a", inProgress(10))]),
          season("2", [episode("b", inProgress(20))]),
        ]),
        lastEpisode: { episodeId: "b", updatedAt: 20 },
      },
      keptEpisodeWatch: () => undefined,
      keptLastEpisode: { episodeId: "a", updatedAt: 30 },
    });

    expect(view.focus).toEqual({ seasonIndex: 0, episodeId: "a" });
  });

  it("opens a watched Series at its first Episode that plays", () => {
    const view = buildTVSeriesView({
      series: series([
        season("1", [
          episode("gone", { missing: true }),
          episode("a", { watch: watched }),
        ]),
      ]),
      keptEpisodeWatch: () => undefined,
    });

    expect(view.focus).toEqual({ seasonIndex: 0, episodeId: "a" });
  });

  it("has nothing to focus when no Episode plays", () => {
    const view = buildTVSeriesView({
      series: series([season("1", [episode("gone", { missing: true })])]),
      keptEpisodeWatch: () => undefined,
    });

    expect(view.focus).toBeNull();
  });
});
