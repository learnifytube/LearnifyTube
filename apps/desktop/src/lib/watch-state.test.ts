import { getWatchState, isPlayedEnough } from "./watch-state";

describe("isPlayedEnough", () => {
  it("is true once about 90% of the Video has played", () => {
    expect(isPlayedEnough(90, 100)).toBe(true);
    expect(isPlayedEnough(100, 100)).toBe(true);
  });

  it("is false before 90%", () => {
    expect(isPlayedEnough(89, 100)).toBe(false);
    expect(isPlayedEnough(0, 100)).toBe(false);
  });

  it("is false when the duration is unknown", () => {
    expect(isPlayedEnough(500, null)).toBe(false);
    expect(isPlayedEnough(500, 0)).toBe(false);
  });
});

describe("getWatchState", () => {
  it("is watched when watchedAt is set, whatever the position", () => {
    expect(getWatchState({ watchedAt: 1, lastPositionSeconds: 0 })).toBe("watched");
  });

  it("is in progress when started but not watched", () => {
    expect(getWatchState({ watchedAt: null, lastPositionSeconds: 12 })).toBe("in-progress");
  });

  it("is unwatched with no stats or no position", () => {
    expect(getWatchState({ watchedAt: null, lastPositionSeconds: 0 })).toBe("unwatched");
    expect(getWatchState({ watchedAt: null, lastPositionSeconds: null })).toBe("unwatched");
  });
});
