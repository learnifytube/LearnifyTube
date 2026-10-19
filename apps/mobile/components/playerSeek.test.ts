import {
  addSeekNudge,
  formatPlaybackTime,
  formatSeekNudge,
  isSeekPending,
  planSeek,
  SEEK_STEP_SECONDS,
} from "./playerSeek";

describe("formatPlaybackTime", () => {
  it("shows minutes and seconds under an hour", () => {
    expect(formatPlaybackTime(0)).toBe("0:00");
    expect(formatPlaybackTime(65.9)).toBe("1:05");
    expect(formatPlaybackTime(599)).toBe("9:59");
  });

  it("adds hours from an hour on", () => {
    expect(formatPlaybackTime(3600)).toBe("1:00:00");
    expect(formatPlaybackTime(3723)).toBe("1:02:03");
  });

  it("treats unknown or negative times as zero", () => {
    expect(formatPlaybackTime(NaN)).toBe("0:00");
    expect(formatPlaybackTime(-5)).toBe("0:00");
  });
});

describe("planSeek", () => {
  it("steps forward and back from the current time", () => {
    expect(
      planSeek({
        currentTime: 30,
        duration: 100,
        pending: null,
        now: 0,
        direction: 1,
      }),
    ).toEqual({ target: 30 + SEEK_STEP_SECONDS, at: 0 });
    expect(
      planSeek({
        currentTime: 30,
        duration: 100,
        pending: null,
        now: 0,
        direction: -1,
      }),
    ).toEqual({ target: 30 - SEEK_STEP_SECONDS, at: 0 });
  });

  it("adds up presses that come before the player catches up", () => {
    const first = planSeek({
      currentTime: 30,
      duration: 100,
      pending: null,
      now: 0,
      direction: 1,
    });
    const second = planSeek({
      currentTime: 30,
      duration: 100,
      pending: first,
      now: 300,
      direction: 1,
    });
    const third = planSeek({
      currentTime: 31,
      duration: 100,
      pending: second,
      now: 600,
      direction: -1,
    });

    expect(second.target).toBe(50);
    expect(third.target).toBe(40);
  });

  it("starts from the current time again once presses pause", () => {
    const first = planSeek({
      currentTime: 30,
      duration: 100,
      pending: null,
      now: 0,
      direction: 1,
    });
    const later = planSeek({
      currentTime: 45,
      duration: 100,
      pending: first,
      now: 5000,
      direction: 1,
    });

    expect(later.target).toBe(55);
  });

  it("stays within the Video", () => {
    expect(
      planSeek({
        currentTime: 4,
        duration: 100,
        pending: null,
        now: 0,
        direction: -1,
      }).target,
    ).toBe(0);
    expect(
      planSeek({
        currentTime: 95,
        duration: 100,
        pending: null,
        now: 0,
        direction: 1,
      }).target,
    ).toBe(100);
  });

  it("doesn't cap forward seeks while the duration is unknown", () => {
    expect(
      planSeek({
        currentTime: 95,
        duration: 0,
        pending: null,
        now: 0,
        direction: 1,
      }).target,
    ).toBe(105);
  });
});

describe("isSeekPending", () => {
  it("holds a seek until presses pause", () => {
    const seek = planSeek({
      currentTime: 30,
      duration: 100,
      pending: null,
      now: 0,
      direction: 1,
    });

    expect(isSeekPending(seek, 500)).toBe(true);
    expect(isSeekPending(seek, 5000)).toBe(false);
    expect(isSeekPending(null, 0)).toBe(false);
  });
});

describe("addSeekNudge", () => {
  it("adds up quick taps in the same direction", () => {
    const first = addSeekNudge(null, 1, 0);
    const second = addSeekNudge(first, 1, 400);
    const third = addSeekNudge(second, 1, 800);

    expect(first.amount).toBe(SEEK_STEP_SECONDS);
    expect(third.amount).toBe(3 * SEEK_STEP_SECONDS);
    expect(formatSeekNudge(third.amount)).toBe("+30s");
  });

  it("starts over when the direction flips or taps pause", () => {
    const forward = addSeekNudge(null, 1, 0);

    expect(addSeekNudge(forward, -1, 400).amount).toBe(-SEEK_STEP_SECONDS);
    expect(addSeekNudge(forward, 1, 5000).amount).toBe(SEEK_STEP_SECONDS);
    expect(formatSeekNudge(-SEEK_STEP_SECONDS)).toBe("−10s");
  });
});
