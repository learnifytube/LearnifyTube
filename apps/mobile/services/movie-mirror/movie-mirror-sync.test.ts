import type { Movie, MovieCatalog } from "../../../shared/mobile-sync-contract";
import { createHeldMovies } from "../held-movies/createHeldMovies";
import { createFakeHeldMoviesPlatform } from "../held-movies/fakeHeldMoviesPlatform";
import { createKeptCaptions } from "../movie-captions/createKeptCaptions";
import { createFakeKeptCaptionsPlatform } from "../movie-captions/fakeKeptCaptionsPlatform";
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

const SERVER = "http://desktop";

function createHarness() {
  const fake = createFakeHeldMoviesPlatform();
  const held = createHeldMovies(fake.platform);
  const captionFiles = createFakeKeptCaptionsPlatform({
    served: { "up-en": "WEBVTT", "up-fr": "WEBVTT", "e1-en": "WEBVTT" },
  });
  const captions = createKeptCaptions(captionFiles.platform);
  const mirror = createMovieMirror({ held, captions });
  return { fake, held, mirror, captionFiles };
}

describe("Movie Mirror", () => {
  it("Downloads a sent Movie without the user asking", async () => {
    const { fake, held, mirror } = createHarness();
    await mirror.mirror(
      SERVER,
      catalogOf(movie("up", true), movie("alien", false)),
    );

    expect(fake.queued()).toEqual(["up"]);
    expect(held.getHold("up")?.reasons).toEqual(["mirrored"]);
  });

  it("reports the sent Movie as held once its Offline copy arrives", async () => {
    const { fake, mirror } = createHarness();
    await mirror.mirror(SERVER, catalogOf(movie("up", true)));
    expect(mirror.heldIds()).toEqual({ movieIds: [], episodeIds: [] });

    fake.finishDownload("up");

    expect(mirror.heldIds()).toEqual({ movieIds: ["up"], episodeIds: [] });
  });

  it("removes the Movie at the next Mirror once it is removed from Devices", async () => {
    const { fake, held, mirror } = createHarness();
    await mirror.mirror(SERVER, catalogOf(movie("up", true)));
    fake.finishDownload("up");

    await mirror.mirror(SERVER, catalogOf(movie("up", false)));

    expect(held.getHold("up")).toBeNull();
    expect(fake.copies()).toEqual([]);
  });

  it("removes a sent Movie the desktop no longer lists (forgotten, or not Shown on Devices)", async () => {
    const { fake, held, mirror } = createHarness();
    await mirror.mirror(SERVER, catalogOf(movie("up", true)));
    fake.finishDownload("up");

    await mirror.mirror(SERVER, catalogOf());

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

    await mirror.mirror(SERVER, catalogOf(movie("up", true)));
    await mirror.mirror(SERVER, catalogOf(movie("up", false)));

    expect(held.getHold("up")?.reasons).toEqual(["pulled"]);
    expect(fake.copies()).toEqual(["up"]);
  });
});

describe("Season Mirror", () => {
  it("Downloads every Episode of a sent Season and reports them once held", async () => {
    const { fake, held, mirror } = createHarness();
    await mirror.mirror(SERVER, officeCatalog(true));

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
    await mirror.mirror(SERVER, officeCatalog(true));
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

    await mirror.mirror(SERVER, officeCatalog(false));

    expect(held.getHold("e1")).toBeNull();
    expect(held.getHold("e2")).toBeNull();
    expect(fake.copies()).toEqual(["e3"]);
  });
});

describe("Captions of held titles", () => {
  const english = { id: "up-en", language: "en", label: "English" };
  const french = { id: "up-fr", language: "fr", label: "French" };

  it("keeps a sent Movie's Captions once its Offline copy arrives", async () => {
    const { fake, mirror, captionFiles } = createHarness();
    const up = { ...movie("up", true), captions: [english, french] };
    await mirror.mirror(SERVER, catalogOf(up));
    expect(captionFiles.files()).toEqual([]);

    fake.finishDownload("up");
    await mirror.mirror(SERVER, catalogOf(up));
    expect(captionFiles.files()).toEqual(["up/up-en", "up/up-fr"]);
  });

  it("keeps the Captions of a title the user downloaded, and an Episode's", async () => {
    const { fake, held, mirror, captionFiles } = createHarness();
    held.pull({
      kind: "movie",
      id: "up",
      title: "Up",
      posterUrl: null,
      durationSeconds: 6000,
    });
    fake.finishDownload("up");
    const catalog = officeCatalog(true);
    catalog.series[0].seasons[0].episodes[0].captions = [
      { id: "e1-en", language: "en", label: "English" },
    ];
    catalog.movies = [{ ...movie("up", false), captions: [english] }];
    await mirror.mirror(SERVER, catalog);
    fake.finishDownload("e1");
    await mirror.mirror(SERVER, catalog);

    expect(captionFiles.files()).toEqual(["e1/e1-en", "up/up-en"]);
  });

  it("drops a Caption the desktop no longer pairs with a held title", async () => {
    const { fake, mirror, captionFiles } = createHarness();
    await mirror.mirror(SERVER, catalogOf(movie("up", true)));
    fake.finishDownload("up");
    await mirror.mirror(
      SERVER,
      catalogOf({ ...movie("up", true), captions: [english, french] }),
    );
    await mirror.mirror(
      SERVER,
      catalogOf({ ...movie("up", true), captions: [french] }),
    );

    expect(captionFiles.files()).toEqual(["up/up-fr"]);
  });
});
