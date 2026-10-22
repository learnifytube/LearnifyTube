import { currentMovieWatch, resumeAt } from "./movieWatch";

const desktop = (
  positionSeconds: number,
  updatedAt: number,
  watched = false,
) => ({
  positionSeconds,
  watched,
  updatedAt,
});

const kept = (lastPositionSeconds: number, lastWatchedAt: number) => ({
  kind: "movie" as const,
  id: "up",
  lastPositionSeconds,
  lastWatchedAt,
});

describe("Movie watch", () => {
  it("starts from the beginning when nothing was watched", () => {
    expect(
      resumeAt({ watch: null, kept: undefined, durationSeconds: 6000 }),
    ).toBe(0);
  });

  it("resumes where the desktop or another Device left off", () => {
    expect(
      resumeAt({
        watch: desktop(1200, 50),
        kept: undefined,
        durationSeconds: 6000,
      }),
    ).toBe(1200);
  });

  it("resumes where this phone left off when that is newer than the desktop", () => {
    expect(
      resumeAt({
        watch: desktop(1200, 50),
        kept: kept(2400, 60),
        durationSeconds: 6000,
      }),
    ).toBe(2400);
  });

  it("follows a desktop change made after this phone last played", () => {
    expect(
      resumeAt({
        watch: desktop(0, 70, true),
        kept: kept(2400, 60),
        durationSeconds: 6000,
      }),
    ).toBe(0);
  });

  it("starts again from the beginning once the end was reached", () => {
    expect(
      resumeAt({ watch: null, kept: kept(5900, 60), durationSeconds: 6000 }),
    ).toBe(0);
  });

  it("says where it is newest, phone or desktop", () => {
    expect(currentMovieWatch(desktop(1200, 50), kept(2400, 60))).toEqual({
      positionSeconds: 2400,
      updatedAt: 60,
    });
    expect(currentMovieWatch(desktop(1200, 70), kept(2400, 60))).toEqual({
      positionSeconds: 1200,
      updatedAt: 70,
    });
    expect(currentMovieWatch(null, undefined)).toBeNull();
  });
});
