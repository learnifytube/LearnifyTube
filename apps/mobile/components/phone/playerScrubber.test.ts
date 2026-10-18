import {
  calculateProgressPercent,
  calculateScrubTime,
  formatPlayerTime,
} from "./playerScrubber";

describe("formatPlayerTime", () => {
  it("formats 0 seconds as 0:00", () => {
    expect(formatPlayerTime(0)).toBe("0:00");
  });

  it("formats under a minute with leading zero for seconds", () => {
    expect(formatPlayerTime(9)).toBe("0:09");
    expect(formatPlayerTime(45)).toBe("0:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatPlayerTime(75)).toBe("1:15");
    expect(formatPlayerTime(600)).toBe("10:00");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatPlayerTime(3600)).toBe("1:00:00");
    expect(formatPlayerTime(3665)).toBe("1:01:05");
  });

  it("handles non-finite and negative values gracefully", () => {
    expect(formatPlayerTime(-10)).toBe("0:00");
    expect(formatPlayerTime(NaN)).toBe("0:00");
    expect(formatPlayerTime(Infinity)).toBe("0:00");
  });
});

describe("calculateScrubTime", () => {
  it("calculates exact scrub target along the track", () => {
    expect(calculateScrubTime(50, 100, 120)).toBe(60);
    expect(calculateScrubTime(25, 100, 120)).toBe(30);
  });

  it("clamps scrub position when dragged past edges", () => {
    expect(calculateScrubTime(-20, 100, 120)).toBe(0);
    expect(calculateScrubTime(150, 100, 120)).toBe(120);
  });

  it("returns 0 if duration or track width is zero or invalid", () => {
    expect(calculateScrubTime(50, 0, 120)).toBe(0);
    expect(calculateScrubTime(50, 100, 0)).toBe(0);
    expect(calculateScrubTime(50, 100, -5)).toBe(0);
  });
});

describe("calculateProgressPercent", () => {
  it("calculates percentage accurately", () => {
    expect(calculateProgressPercent(30, 120)).toBe(25);
    expect(calculateProgressPercent(60, 120)).toBe(50);
  });

  it("clamps between 0 and 100", () => {
    expect(calculateProgressPercent(-10, 100)).toBe(0);
    expect(calculateProgressPercent(150, 100)).toBe(100);
  });

  it("returns 0 for zero or negative duration", () => {
    expect(calculateProgressPercent(10, 0)).toBe(0);
    expect(calculateProgressPercent(10, -50)).toBe(0);
  });
});
