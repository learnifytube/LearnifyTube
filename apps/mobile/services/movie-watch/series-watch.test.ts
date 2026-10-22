import type {
  Episode,
  MovieWatch,
  Series,
} from "../../../shared/mobile-sync-contract";
import { seriesEpisodeAfter, seriesNextUp } from "./seriesWatch";

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

const series = (...seasons: Episode[][]): Series => ({
  id: "office",
  title: "The Office",
  posterUrl: null,
  seasons: seasons.map((episodes, index) => ({
    id: `s${index + 1}`,
    title: `Season ${index + 1}`,
    number: index + 1,
    sentToDevices: false,
    episodes,
  })),
});

const onDesktop = (positionSeconds: number, updatedAt: number, watched = false) => ({
  watch: { positionSeconds, watched, updatedAt },
});

const keptOnPhone =
  (entries: Record<string, [number, number]>) =>
  (id: string): MovieWatch | undefined =>
    entries[id]
      ? {
          kind: "episode",
          id,
          lastPositionSeconds: entries[id][0],
          lastWatchedAt: entries[id][1],
        }
      : undefined;

const none = keptOnPhone({});

describe("Series next up", () => {
  it("starts a Series nobody watched at its first Episode, not yet started", () => {
    expect(seriesNextUp(series([episode("e1"), episode("e2")]), none)).toEqual({
      episode: episode("e1"),
      lastWatchedAt: null,
    });
  });

  it("carries on with the Episode in progress", () => {
    const next = seriesNextUp(
      series([episode("e1", onDesktop(1000, 10, true)), episode("e2")], [
        episode("e3"),
      ]),
      keptOnPhone({ e2: [300, 20] }),
    );
    expect(next?.episode.id).toBe("e2");
    expect(next?.lastWatchedAt).toBe(20);
  });

  it("moves on to the next Season once a Season is watched", () => {
    const next = seriesNextUp(
      series([episode("e1", onDesktop(1000, 10, true))], [episode("e2")]),
      none,
    );
    expect(next).toEqual({ episode: episode("e2"), lastWatchedAt: 10 });
  });

  it("skips Episodes whose file is missing", () => {
    expect(
      seriesNextUp(
        series([episode("e1", { missing: true }), episode("e2")]),
        none,
      )?.episode.id,
    ).toBe("e2");
  });

  it("follows a desktop mark made after the phone last played", () => {
    const next = seriesNextUp(
      series([episode("e1", onDesktop(0, 30, true)), episode("e2")]),
      keptOnPhone({ e1: [400, 20] }),
    );
    expect(next?.episode.id).toBe("e2");
    expect(next?.lastWatchedAt).toBe(30);
  });

  it("autoplays the next Episode in order, across Seasons, skipping missing ones", () => {
    const office = series(
      [episode("e1"), episode("e2", { missing: true })],
      [episode("e3", onDesktop(1000, 10, true))],
    );
    expect(seriesEpisodeAfter(office, "e1")?.id).toBe("e3");
    expect(seriesEpisodeAfter(office, "e3")).toBeNull();
  });

  it("is done once no unwatched Episode is left", () => {
    expect(
      seriesNextUp(
        series([
          episode("e1", onDesktop(1000, 10, true)),
          episode("e2", { missing: true }),
        ]),
        keptOnPhone({}),
      ),
    ).toBeNull();
    expect(
      seriesNextUp(series([episode("e1")]), keptOnPhone({ e1: [950, 20] })),
    ).toBeNull();
  });
});
