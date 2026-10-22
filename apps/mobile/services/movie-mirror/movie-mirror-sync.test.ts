import type {
  Movie,
  MovieCatalog,
} from "../../../shared/mobile-sync-contract";
import { createHeldMovies } from "../held-movies/createHeldMovies";
import { createFakeHeldMoviesPlatform } from "../held-movies/fakeHeldMoviesPlatform";
import { createMovieMirror } from "./createMovieMirror";

const SERVER = "http://desktop";

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

const catalogOf = (...movies: Movie[]): MovieCatalog => ({ movies, series: [] });

function createHarness() {
  const fake = createFakeHeldMoviesPlatform();
  const held = createHeldMovies(fake.platform);
  let catalog: MovieCatalog | null = catalogOf();
  const kept: { serverUrl: string; catalog: MovieCatalog }[] = [];
  const mirror = createMovieMirror({
    loadCatalog: async () => catalog,
    held,
    keepCatalog: (serverUrl, served) => kept.push({ serverUrl, catalog: served }),
  });
  const desktopServes = (next: MovieCatalog | null) => {
    catalog = next;
  };
  return { fake, held, mirror, desktopServes, kept };
}

describe("Movie Mirror", () => {
  it("Downloads a sent Movie without the user asking", async () => {
    const { fake, held, mirror, desktopServes } = createHarness();
    desktopServes(catalogOf(movie("up", true), movie("alien", false)));

    await mirror.mirror(SERVER);

    expect(fake.queued()).toEqual(["up"]);
    expect(held.getHold("up")?.reasons).toEqual(["mirrored"]);
  });

  it("reports the sent Movie as held once its Offline copy arrives", async () => {
    const { fake, mirror, desktopServes } = createHarness();
    desktopServes(catalogOf(movie("up", true)));
    await mirror.mirror(SERVER);
    expect(mirror.heldIds()).toEqual({ movieIds: [], episodeIds: [] });

    fake.finishDownload("up");

    expect(mirror.heldIds()).toEqual({ movieIds: ["up"], episodeIds: [] });
  });

  it("removes the Movie at the next Mirror once it is removed from Devices", async () => {
    const { fake, held, mirror, desktopServes } = createHarness();
    desktopServes(catalogOf(movie("up", true)));
    await mirror.mirror(SERVER);
    fake.finishDownload("up");

    desktopServes(catalogOf(movie("up", false)));
    await mirror.mirror(SERVER);

    expect(held.getHold("up")).toBeNull();
    expect(fake.copies()).toEqual([]);
  });

  it("removes a sent Movie the desktop no longer lists (forgotten, or not Shown on Devices)", async () => {
    const { fake, held, mirror, desktopServes } = createHarness();
    desktopServes(catalogOf(movie("up", true)));
    await mirror.mirror(SERVER);
    fake.finishDownload("up");

    desktopServes(catalogOf());
    await mirror.mirror(SERVER);

    expect(held.getHold("up")).toBeNull();
  });

  it("never removes a Movie the user downloaded to this phone", async () => {
    const { fake, held, mirror, desktopServes } = createHarness();
    held.pull({ kind: "movie", id: "up", title: "up", posterUrl: null, durationSeconds: 6000 });
    fake.finishDownload("up");

    desktopServes(catalogOf(movie("up", true)));
    await mirror.mirror(SERVER);
    desktopServes(catalogOf(movie("up", false)));
    await mirror.mirror(SERVER);

    expect(held.getHold("up")?.reasons).toEqual(["pulled"]);
    expect(fake.copies()).toEqual(["up"]);
  });

  it("changes nothing on a desktop too old to serve Movies", async () => {
    const { held, mirror, desktopServes, kept } = createHarness();
    desktopServes(catalogOf(movie("up", true)));
    await mirror.mirror(SERVER);

    desktopServes(null);
    await mirror.mirror(SERVER);

    expect(held.getHold("up")?.reasons).toEqual(["mirrored"]);
    expect(kept).toHaveLength(1);
  });

  it("keeps each catalog it loads, so the Home rows show what the desktop just changed", async () => {
    const { mirror, desktopServes, kept } = createHarness();
    const served = catalogOf(movie("up", true));
    desktopServes(served);

    await mirror.mirror(SERVER);

    expect(kept).toEqual([{ serverUrl: SERVER, catalog: served }]);
  });
});
