import type {
  Episode,
  Movie,
  MovieCatalog,
  Season,
  Series,
} from "../../../shared/mobile-sync-contract";
import { planMovieMirror, sentTitles } from "./planMovieMirror";

const movie = (id: string, overrides: Partial<Movie> = {}): Movie => ({
  id,
  title: id,
  posterUrl: null,
  durationSeconds: 6000,
  missing: false,
  captions: [],
  sentToDevices: true,
  watch: null,
  ...overrides,
});

const sent = (id: string, missing = false) => ({ id, missing });

const episode = (id: string, overrides: Partial<Episode> = {}): Episode => ({
  id,
  title: id,
  number: null,
  durationSeconds: 1200,
  missing: false,
  captions: [],
  watch: null,
  ...overrides,
});

const season = (
  id: string,
  sentToDevices: boolean,
  episodes: Episode[],
): Season => ({ id, title: id, number: null, sentToDevices, episodes });

const office = (...seasons: Season[]): Series => ({
  id: "office",
  title: "The Office",
  posterUrl: "/api/series/office/poster?v=1",
  seasons,
});

describe("planMovieMirror", () => {
  it("Downloads every sent Movie the phone doesn't hold", () => {
    const plan = planMovieMirror({
      sent: [sent("up"), sent("alien")],
      holds: [],
    });

    expect(plan.download).toEqual(["up", "alien"]);
    expect(plan.release).toEqual([]);
  });

  it("keeps asking for a sent Movie the Mirror brought, so a failed Download retries", () => {
    const plan = planMovieMirror({
      sent: [sent("up")],
      holds: [{ id: "up", reasons: ["mirrored"] }],
    });

    expect(plan.download).toEqual(["up"]);
    expect(plan.release).toEqual([]);
  });

  it("removes a Movie the Mirror brought once it is no longer sent", () => {
    const plan = planMovieMirror({
      sent: [],
      holds: [{ id: "up", reasons: ["mirrored"] }],
    });

    expect(plan.download).toEqual([]);
    expect(plan.release).toEqual(["up"]);
  });

  it("removes a title the Mirror brought once the catalog no longer lists it", () => {
    // A title switched off Shown on Devices, or forgotten, is left out of the
    // catalog entirely: the Device never sees it marked as not sent.
    const plan = planMovieMirror({
      sent: sentTitles({ movies: [movie("alien")], series: [] }),
      holds: [
        { id: "up", reasons: ["mirrored"] },
        { id: "alien", reasons: ["mirrored"] },
      ],
    });

    expect(plan.release).toEqual(["up"]);
  });

  it("never claims or removes a Movie the user downloaded to this phone", () => {
    const whileSent = planMovieMirror({
      sent: [sent("up")],
      holds: [{ id: "up", reasons: ["pulled"] }],
    });
    expect(whileSent.download).toEqual([]);

    const unsent = planMovieMirror({
      sent: [],
      holds: [{ id: "up", reasons: ["pulled"] }],
    });
    expect(unsent.release).toEqual([]);
  });

  it("drops only its own reason from a Movie the user also downloaded", () => {
    const plan = planMovieMirror({
      sent: [],
      holds: [{ id: "up", reasons: ["mirrored", "pulled"] }],
    });

    // Releasing drops the Mirror's reason; the user's keeps the Offline copy.
    expect(plan.release).toEqual(["up"]);
  });

  it("doesn't Download a sent Movie whose file is missing on the desktop, but keeps the copy it has", () => {
    const plan = planMovieMirror({
      sent: [sent("up", true), sent("alien", true)],
      holds: [{ id: "up", reasons: ["mirrored"] }],
    });

    expect(plan.download).toEqual([]);
    expect(plan.release).toEqual([]);
  });
});

describe("sentTitles", () => {
  it("lists the Movies sent to Devices, with what the phone shows of each", () => {
    const catalog: MovieCatalog = {
      movies: [
        movie("up", { title: "Up", posterUrl: "/api/movie/up/poster?v=1" }),
        movie("alien", { sentToDevices: false }),
        movie("heat", { missing: true }),
      ],
      series: [],
    };

    expect(sentTitles(catalog)).toEqual([
      {
        kind: "movie",
        id: "up",
        title: "Up",
        posterUrl: "/api/movie/up/poster?v=1",
        durationSeconds: 6000,
        missing: false,
      },
      {
        kind: "movie",
        id: "heat",
        title: "heat",
        posterUrl: null,
        durationSeconds: 6000,
        missing: true,
      },
    ]);
  });

  it("lists every Episode of a sent Season, as the phone shows it, and none of an unsent one", () => {
    const catalog: MovieCatalog = {
      movies: [],
      series: [
        office(
          season("s1", true, [
            episode("e1", { title: "Pilot" }),
            episode("e2", { title: "Diversity Day", missing: true }),
          ]),
          season("s2", false, [episode("e3")]),
        ),
      ],
    };

    expect(sentTitles(catalog)).toEqual([
      {
        kind: "episode",
        id: "e1",
        title: "The Office · Pilot",
        posterUrl: "/api/series/office/poster?v=1",
        durationSeconds: 1200,
        missing: false,
      },
      {
        kind: "episode",
        id: "e2",
        title: "The Office · Diversity Day",
        posterUrl: "/api/series/office/poster?v=1",
        durationSeconds: 1200,
        missing: true,
      },
    ]);
  });

  it("lets go of the Episodes the Mirror brought once their Season is no longer sent", () => {
    const plan = planMovieMirror({
      sent: sentTitles({
        movies: [],
        series: [office(season("s1", false, [episode("e1")]))],
      }),
      holds: [
        { id: "e1", reasons: ["mirrored"] },
        // Downloaded to this phone by the user: stays.
        { id: "e2", reasons: ["pulled"] },
      ],
    });

    expect(plan.download).toEqual([]);
    expect(plan.release).toEqual(["e1"]);
  });

  it("Downloads an Episode a Rescan added to a sent Season", () => {
    const plan = planMovieMirror({
      sent: sentTitles({
        movies: [],
        series: [office(season("s1", true, [episode("e1"), episode("e2")]))],
      }),
      holds: [{ id: "e1", reasons: ["mirrored"] }],
    });

    expect(plan.download).toEqual(["e1", "e2"]);
    expect(plan.release).toEqual([]);
  });
});
