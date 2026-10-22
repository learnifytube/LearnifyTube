import type { Movie, MovieCatalog } from "../../../shared/mobile-sync-contract";
import { createHeldMovies } from "../held-movies/createHeldMovies";
import { createFakeHeldMoviesPlatform } from "../held-movies/fakeHeldMoviesPlatform";
import { createMovieMirror } from "./createMovieMirror";

const movie = (id: string, sentToDevices: boolean): Movie => ({
  id,
  title: id,
  posterUrl: null,
  durationSeconds: 6000,
  missing: false,
  captions: [],
  sentToDevices,
  watch: null,
});

const catalogOf = (...movies: Movie[]): MovieCatalog => ({
  movies,
  series: [],
});

function createHarness() {
  const fake = createFakeHeldMoviesPlatform();
  const held = createHeldMovies(fake.platform);
  const mirror = createMovieMirror({ held });
  return { fake, held, mirror };
}

describe("Movie Mirror", () => {
  it("Downloads a sent Movie without the user asking", async () => {
    const { fake, held, mirror } = createHarness();
    await mirror.mirror(catalogOf(movie("up", true), movie("alien", false)));

    expect(fake.queued()).toEqual(["up"]);
    expect(held.getHold("up")?.reasons).toEqual(["mirrored"]);
  });

  it("reports the sent Movie as held once its Offline copy arrives", async () => {
    const { fake, mirror } = createHarness();
    await mirror.mirror(catalogOf(movie("up", true)));
    expect(mirror.heldIds()).toEqual({ movieIds: [], episodeIds: [] });

    fake.finishDownload("up");

    expect(mirror.heldIds()).toEqual({ movieIds: ["up"], episodeIds: [] });
  });

  it("removes the Movie at the next Mirror once it is removed from Devices", async () => {
    const { fake, held, mirror } = createHarness();
    await mirror.mirror(catalogOf(movie("up", true)));
    fake.finishDownload("up");

    await mirror.mirror(catalogOf(movie("up", false)));

    expect(held.getHold("up")).toBeNull();
    expect(fake.copies()).toEqual([]);
  });

  it("removes a sent Movie the desktop no longer lists (forgotten, or not Shown on Devices)", async () => {
    const { fake, held, mirror } = createHarness();
    await mirror.mirror(catalogOf(movie("up", true)));
    fake.finishDownload("up");

    await mirror.mirror(catalogOf());

    expect(held.getHold("up")).toBeNull();
  });

  it("never removes a Movie the user downloaded to this phone", async () => {
    const { fake, held, mirror } = createHarness();
    held.pull({
      kind: "movie",
      id: "up",
      title: "up",
      posterUrl: null,
      durationSeconds: 6000,
    });
    fake.finishDownload("up");

    await mirror.mirror(catalogOf(movie("up", true)));
    await mirror.mirror(catalogOf(movie("up", false)));

    expect(held.getHold("up")?.reasons).toEqual(["pulled"]);
    expect(fake.copies()).toEqual(["up"]);
  });
});
