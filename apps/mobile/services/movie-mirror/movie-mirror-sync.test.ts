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

// The Office, with Season 1 (e1, e2) sent or not, and Season 2 (e3) never sent.
const officeCatalog = (season1Sent: boolean): MovieCatalog => {
  const episode = (id: string) => ({
    id,
    title: id,
    number: null,
    durationSeconds: 1200,
    missing: false,
    captions: [],
    watch: null,
  });
  return {
    movies: [],
    series: [
      {
        id: "office",
        title: "The Office",
        posterUrl: null,
        seasons: [
          {
            id: "s1",
            title: "Season 1",
            number: 1,
            sentToDevices: season1Sent,
            episodes: [episode("e1"), episode("e2")],
          },
          {
            id: "s2",
            title: "Season 2",
            number: 2,
            sentToDevices: false,
            episodes: [episode("e3")],
          },
        ],
      },
    ],
  };
};

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

describe("Season Mirror", () => {
  it("Downloads every Episode of a sent Season and reports them once held", async () => {
    const { fake, held, mirror } = createHarness();
    await mirror.mirror(officeCatalog(true));

    expect(fake.queued()).toEqual(["e1", "e2"]);
    expect(held.getHold("e1")).toMatchObject({
      kind: "episode",
      title: "The Office · e1",
      reasons: ["mirrored"],
    });

    fake.finishDownload("e1");
    fake.finishDownload("e2");
    expect(mirror.heldIds()).toEqual({
      movieIds: [],
      episodeIds: expect.arrayContaining(["e1", "e2"]),
    });
  });

  it("removes the Episodes it brought once the Season is removed from Devices, but not one the user downloaded", async () => {
    const { fake, held, mirror } = createHarness();
    await mirror.mirror(officeCatalog(true));
    fake.finishDownload("e1");
    fake.finishDownload("e2");
    held.pull({
      kind: "episode",
      id: "e3",
      title: "The Office · e3",
      posterUrl: null,
      durationSeconds: 1200,
    });
    fake.finishDownload("e3");

    await mirror.mirror(officeCatalog(false));

    expect(held.getHold("e1")).toBeNull();
    expect(held.getHold("e2")).toBeNull();
    expect(fake.copies()).toEqual(["e3"]);
  });
});
