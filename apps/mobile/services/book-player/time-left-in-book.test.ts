import {
  formatTimeLeft,
  timeLeftInBook,
} from "../../../shared/book-player/timeLeftInBook";

const track = (durationSeconds: number | null, missing = false) => ({
  id: String(Math.random()),
  title: "Track",
  durationSeconds,
  missing,
});

describe("time left in book", () => {
  it("counts the rest of the Track playing and every later Track", () => {
    const tracks = [track(600), track(1200), track(1800)];
    expect(
      timeLeftInBook({ tracks, trackIndex: 1, elapsed: 200, speed: 1 }),
    ).toBe(1000 + 1800);
  });

  it("is real time at the book's speed", () => {
    const tracks = [track(3600), track(7200)];
    expect(
      timeLeftInBook({ tracks, trackIndex: 0, elapsed: 0, speed: 1.5 }),
    ).toBe(7200);
  });

  it("leaves out missing Tracks, which never play", () => {
    const tracks = [track(600), track(null, true), track(900)];
    expect(
      timeLeftInBook({ tracks, trackIndex: 0, elapsed: 100, speed: 1 }),
    ).toBe(500 + 900);
  });

  it("is unknown when a Track still to play has no known length", () => {
    const tracks = [track(600), track(null), track(900)];
    expect(
      timeLeftInBook({ tracks, trackIndex: 0, elapsed: 100, speed: 1 }),
    ).toBeNull();
  });

  it("takes the playing Track's length from its file once the player knows it", () => {
    const tracks = [track(null), track(900)];
    expect(
      timeLeftInBook({
        tracks,
        trackIndex: 0,
        elapsed: 100,
        trackLength: 600,
        speed: 1,
      }),
    ).toBe(500 + 900);
  });
});

describe("time left wording", () => {
  it("reads in hours and minutes, rounding up to the next minute", () => {
    expect(formatTimeLeft(2 * 3600 + 7 * 60 + 30)).toBe("2h 08m");
    expect(formatTimeLeft(45 * 60)).toBe("45m");
    expect(formatTimeLeft(20)).toBe("1m");
  });
});
