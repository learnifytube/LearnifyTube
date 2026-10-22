import type { Movie, MovieCatalog } from "../../../shared/mobile-sync-contract";
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
});
