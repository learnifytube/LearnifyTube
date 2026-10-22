import type { Movie } from "../../../shared/mobile-sync-contract";
import { moviesRowItems } from "./moviesRowItems";

const movie = (id: string, overrides: Partial<Movie> = {}): Movie => ({
  id,
  title: id,
  posterUrl: null,
  durationSeconds: 6000,
  missing: false,
  captions: [],
  sentToDevices: false,
  watch: null,
  ...overrides,
});

describe("Movies row", () => {
  it("shows the desktop's Movies in its order, ready to Stream", () => {
    expect(
      moviesRowItems({
        connected: true,
        movies: [movie("alien"), movie("up")],
      }),
    ).toEqual([
      { movie: movie("alien"), needsDesktop: false },
      { movie: movie("up"), needsDesktop: false },
    ]);
  });

  it("leaves out Movies whose file is missing on the desktop", () => {
    expect(
      moviesRowItems({
        connected: true,
        movies: [movie("alien", { missing: true }), movie("up")],
      }).map((item) => item.movie.id),
    ).toEqual(["up"]);
  });

  it("dims every Movie in Offline mode: none is on this phone", () => {
    expect(moviesRowItems({ connected: false, movies: [movie("up")] })).toEqual(
      [{ movie: movie("up"), needsDesktop: true }],
    );
  });
});
