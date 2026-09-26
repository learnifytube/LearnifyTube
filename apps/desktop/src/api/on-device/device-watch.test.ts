import { mergeDeviceWatch } from "./device-watch";

const report = (overrides = {}) => ({
  videoId: "v",
  lastPositionSeconds: 30,
  lastWatchedAt: 2_000,
  ...overrides,
});

describe("mergeDeviceWatch", () => {
  it("takes the Device's progress when the desktop has none", () => {
    expect(mergeDeviceWatch(null, report(), 100)).toEqual({
      lastPositionSeconds: 30,
      lastWatchedAt: 2_000,
      watchedAt: null,
    });
  });

  it("marks the Video watched once the Device played about 90% of it", () => {
    expect(mergeDeviceWatch(null, report({ lastPositionSeconds: 95 }), 100)?.watchedAt).toBe(2_000);
  });

  it("keeps an existing watched mark", () => {
    const existing = { updatedAt: 1_000, watchedAt: 500 };
    expect(mergeDeviceWatch(existing, report(), 100)?.watchedAt).toBe(500);
  });

  it("ignores progress older than the desktop's last change, so manual marks win", () => {
    const existing = { updatedAt: 3_000, watchedAt: null };
    expect(mergeDeviceWatch(existing, report({ lastPositionSeconds: 99 }), 100)).toBeNull();
  });
});
