import { episodeAfter, nextUpEpisode } from "../../../../shared/series/nextUp";

type Ep = {
  id: string;
  missing?: boolean;
  watchState: "unwatched" | "in-progress" | "watched";
  watchUpdatedAt?: number | null;
};

const ep = (id: string, watchState: Ep["watchState"], extra: Partial<Ep> = {}): Ep => ({
  id,
  watchState,
  ...extra,
});

describe("nextUpEpisode", () => {
  it("starts a Series with nothing played yet from its first unwatched Episode", () => {
    expect(nextUpEpisode([ep("e1", "watched"), ep("e2", "unwatched")], null)?.id).toBe("e2");
    expect(nextUpEpisode([ep("e1", "unwatched"), ep("e2", "unwatched")], null)?.id).toBe("e1");
  });

  it("resumes the last Episode played, even with a later Episode in progress", () => {
    // Halfway through e5, the user went back to rewatch e2.
    const episodes = [
      ep("e1", "watched"),
      ep("e2", "in-progress", { watchUpdatedAt: 5 }),
      ep("e3", "watched"),
      ep("e4", "watched"),
      ep("e5", "in-progress", { watchUpdatedAt: 9 }),
    ];
    expect(nextUpEpisode(episodes, "e2")?.id).toBe("e2");
  });

  it("resumes the last Episode played when it is unwatched", () => {
    expect(nextUpEpisode([ep("e1", "unwatched"), ep("e2", "unwatched")], "e2")?.id).toBe("e2");
  });

  it("starts the next unwatched Episode after the last one once it is watched", () => {
    expect(
      nextUpEpisode(
        [ep("e1", "unwatched"), ep("e2", "watched"), ep("e3", "watched"), ep("e4", "in-progress")],
        "e2"
      )?.id
    ).toBe("e4");
  });

  it("skips missing Episodes, the last one included", () => {
    const episodes = [
      ep("e1", "watched"),
      ep("e2", "in-progress", { missing: true }),
      ep("e3", "unwatched", { missing: true }),
      ep("e4", "unwatched"),
    ];
    expect(nextUpEpisode(episodes, "e2")?.id).toBe("e4");
    expect(nextUpEpisode(episodes, "e1")?.id).toBe("e4");
    expect(nextUpEpisode(episodes, null)?.id).toBe("e4");
  });

  it("goes back to the first unwatched Episode when none is left after the last one", () => {
    expect(nextUpEpisode([ep("e1", "unwatched"), ep("e2", "watched")], "e2")?.id).toBe("e1");
  });

  it("starts the first unwatched Episode when the last one is no longer in the Series", () => {
    expect(nextUpEpisode([ep("e1", "watched"), ep("e2", "unwatched")], "gone")?.id).toBe("e2");
  });

  it("has nothing up next once every Episode it can play is watched", () => {
    const episodes = [ep("e1", "watched"), ep("e2", "unwatched", { missing: true })];
    expect(nextUpEpisode(episodes, "e1")).toBeNull();
    expect(nextUpEpisode(episodes, null)).toBeNull();
    expect(nextUpEpisode([], null)).toBeNull();
  });
});

describe("episodeAfter", () => {
  const order = [
    ep("e1", "watched"),
    ep("e2", "unwatched", { missing: true }),
    ep("e3", "watched"),
    ep("e4", "unwatched"),
  ];

  it("plays the next Episode in order when one ends, watched or not, skipping missing ones", () => {
    expect(episodeAfter(order, "e1")?.id).toBe("e3");
    expect(episodeAfter(order, "e3")?.id).toBe("e4");
  });

  it("stops after the last Episode, or when the Episode is unknown", () => {
    expect(episodeAfter(order, "e4")).toBeNull();
    expect(episodeAfter(order, "nope")).toBeNull();
  });
});
