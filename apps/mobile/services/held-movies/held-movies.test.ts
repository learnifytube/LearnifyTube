import { createHeldMovies } from "./createHeldMovies";
import { createFakeHeldMoviesPlatform } from "./fakeHeldMoviesPlatform";
import type { HeldTitle } from "./types";

const up: HeldTitle = {
  kind: "movie",
  id: "up",
  title: "Up",
  posterUrl: "/api/movie/up/poster?v=1",
  durationSeconds: 5760,
};
const pilot: HeldTitle = {
  kind: "episode",
  id: "pilot",
  title: "Pilot",
  posterUrl: null,
  durationSeconds: 1300,
};

function createHarness(
  options?: Parameters<typeof createFakeHeldMoviesPlatform>[0],
) {
  const fake = createFakeHeldMoviesPlatform(options);
  return { fake, held: createHeldMovies(fake.platform) };
}

describe("Held Movies", () => {
  it("Downloads a Movie the user asks for to this phone and holds it for them", () => {
    const { fake, held } = createHarness();

    held.pull(up);

    expect(fake.queued()).toEqual(["up"]);
    expect(held.getHold("up")).toMatchObject({
      title: "Up",
      reasons: ["pulled"],
    });
  });

  it("reports only the Movies and Episodes whose Offline copy is here", () => {
    const { fake, held } = createHarness();
    held.hold(up, "mirrored");
    held.hold(pilot, "mirrored");
    expect(held.heldIds()).toEqual({ movieIds: [], episodeIds: [] });

    fake.finishDownload("up");
    fake.finishDownload("pilot");

    expect(held.heldIds()).toEqual({ movieIds: ["up"], episodeIds: ["pilot"] });
  });

  it("keeps a copy the user downloaded when the Mirror lets go of it", async () => {
    const { fake, held } = createHarness();
    held.hold(up, "mirrored");
    held.pull(up);
    fake.finishDownload("up");

    await held.release("up", "mirrored");

    expect(held.getHold("up")?.reasons).toEqual(["pulled"]);
    expect(fake.copies()).toEqual(["up"]);
  });

  it("deletes the Offline copy once no reason to hold it is left", async () => {
    const { fake, held } = createHarness();
    held.hold(up, "mirrored");
    fake.finishDownload("up");

    await held.release("up", "mirrored");

    expect(held.getHold("up")).toBeNull();
    expect(fake.copies()).toEqual([]);
  });

  it("stops the Download of a title let go of before it arrived", async () => {
    const { fake, held } = createHarness();
    held.hold(up, "mirrored");

    await held.release("up", "mirrored");

    expect(fake.queued()).toEqual([]);
  });

  it("Remove from this phone deletes the copy whatever the reasons", async () => {
    const { fake, held } = createHarness();
    held.hold(up, "mirrored");
    held.pull(up);
    fake.finishDownload("up");

    await held.remove("up");

    expect(held.getHold("up")).toBeNull();
    expect(fake.copies()).toEqual([]);
    expect(fake.stored()).toEqual([]);
  });

  it("forgets a title's kept Captions with its Offline copy", async () => {
    const { fake, held } = createHarness();
    held.hold(up, "mirrored");
    held.pull(pilot);
    fake.finishDownload("up");
    fake.finishDownload("pilot");

    await held.release("up", "mirrored");
    await held.remove("pilot");

    expect(fake.forgottenCaptions()).toEqual(["up", "pilot"]);
  });

  it("refreshes what it shows of a held title from the desktop's catalog", () => {
    const { held } = createHarness();
    held.hold(up, "mirrored");

    held.hold({ ...up, title: "Up (2009)" }, "mirrored");

    expect(held.getHold("up")).toMatchObject({
      title: "Up (2009)",
      reasons: ["mirrored"],
    });
  });

  it("picks up the holds saved before the app restarted", () => {
    const { held } = createHarness({
      stored: [{ ...up, reasons: ["pulled"], heldAt: 5 }],
      copies: ["up"],
    });

    expect(held.holds().map((hold) => hold.id)).toEqual(["up"]);
    expect(held.heldIds().movieIds).toEqual(["up"]);
  });

  it("lists held titles newest first", () => {
    const { held } = createHarness();
    held.pull(up);
    held.pull(pilot);

    expect(held.holds().map((hold) => hold.id)).toEqual(["pilot", "up"]);
  });
});
