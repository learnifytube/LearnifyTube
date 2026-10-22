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
  it("starts a Series nobody has watched from its first Episode", () => {
    expect(nextUpEpisode([ep("e1", "unwatched"), ep("e2", "unwatched")])?.id).toBe("e1");
  });

  it("resumes the Episode in progress, even when an earlier one is unwatched", () => {
    expect(
      nextUpEpisode([ep("e1", "unwatched"), ep("e2", "watched"), ep("e3", "in-progress")])?.id
    ).toBe("e3");
  });

  it("resumes the Episode in progress that changed last when several are", () => {
    expect(
      nextUpEpisode([
        ep("e1", "in-progress", { watchUpdatedAt: 5 }),
        ep("e2", "in-progress", { watchUpdatedAt: 9 }),
        ep("e3", "in-progress", { watchUpdatedAt: null }),
      ])?.id
    ).toBe("e2");
  });

  it("otherwise picks the first unwatched Episode in order", () => {
    expect(
      nextUpEpisode([ep("e1", "watched"), ep("e2", "unwatched"), ep("e3", "unwatched")])?.id
    ).toBe("e2");
  });

  it("skips Episodes whose file is missing", () => {
    expect(
      nextUpEpisode([
        ep("e1", "watched"),
        ep("e2", "in-progress", { missing: true }),
        ep("e3", "unwatched", { missing: true }),
        ep("e4", "unwatched"),
      ])?.id
    ).toBe("e4");
  });

  it("has nothing up next once every Episode it can play is watched", () => {
    expect(nextUpEpisode([ep("e1", "watched"), ep("e2", "unwatched", { missing: true })])).toBe(
      null
    );
    expect(nextUpEpisode([])).toBeNull();
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
