import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { createHeldAudiobooks } from "./createHeldAudiobooks";
import { createFakeHeldAudiobooksPlatform } from "./fakeHeldAudiobooksPlatform";

const unplayed = {
  listeningPosition: null,
  finished: false,
  sentToDevices: false,
};

const track = (id: string, missing = false) => ({
  id,
  title: `Track ${id}`,
  durationSeconds: 300,
  missing,
});

const frankl: Audiobook = {
  ...unplayed,
  id: "frankl",
  title: "Man's Search for Meaning",
  author: "Viktor Frankl",
  coverUrl: null,
  tracks: [track("cd1-01"), track("gone", true), track("cd3-01")],
};

const orwell: Audiobook = {
  ...unplayed,
  id: "orwell",
  title: "1984",
  author: "George Orwell",
  coverUrl: null,
  tracks: [track("intro"), track("book")],
};

function createHarness(
  fake = createFakeHeldAudiobooksPlatform({ serverUrl: "http://desktop" }),
) {
  const held = createHeldAudiobooks(fake.platform);
  const stop = held.start();
  return { fake, held, stop };
}

describe("Held Audiobooks", () => {
  it("fetches every Track of a pulled book onto the phone", async () => {
    const { fake, held } = createHarness();

    held.pull(frankl);
    await held.idle();

    expect(fake.fetched()).toEqual(["frankl/cd1-01", "frankl/cd3-01"]);
    expect(held.getHold("frankl")).toMatchObject({
      book: frankl,
      reasons: ["pulled"],
      complete: true,
    });
    await expect(held.trackUri("cd3-01")).resolves.toBe(
      "file://storage/frankl/cd3-01",
    );
  });

  it("waits for the desktop before fetching", async () => {
    const { fake, held } = createHarness(createFakeHeldAudiobooksPlatform());

    held.pull(frankl);
    await held.idle();
    expect(fake.fetched()).toEqual([]);
    expect(held.getHold("frankl")).toMatchObject({
      heldTracks: 0,
      totalTracks: 2,
      complete: false,
    });
    await expect(held.trackUri("cd1-01")).resolves.toBeNull();

    fake.setServerUrl("http://desktop");
    await held.idle();
    expect(held.getHold("frankl")).toMatchObject({ complete: true });
  });

  it("fetches books one after another, in the order they were pulled", async () => {
    const { fake, held } = createHarness();

    held.pull(orwell);
    held.pull(frankl);
    await held.idle();

    expect(fake.fetched()).toEqual([
      "orwell/intro",
      "orwell/book",
      "frankl/cd1-01",
      "frankl/cd3-01",
    ]);
  });

  it("resumes a cut-short fetch on the next connection after the app restarts", async () => {
    const fake = createFakeHeldAudiobooksPlatform({
      serverUrl: "http://desktop",
      gatedTrackIds: ["cd3-01"],
    });
    const first = createHarness(fake);
    first.held.pull(frankl);
    await fake.fetchStarted("cd3-01");
    fake.setServerUrl(null);
    await first.held.idle();
    first.stop();
    expect(fake.fetched()).toEqual(["frankl/cd1-01"]);

    fake.releaseTrack("cd3-01");
    const restarted = createHarness(fake);
    await restarted.held.idle();
    expect(restarted.held.getHold("frankl")).toMatchObject({
      reasons: ["pulled"],
      heldTracks: 1,
      complete: false,
    });

    fake.setServerUrl("http://desktop");
    await restarted.held.idle();
    expect(fake.fetched()).toEqual(["frankl/cd1-01", "frankl/cd3-01"]);
    expect(restarted.held.getHold("frankl")).toMatchObject({ complete: true });
  });

  it("stops fetching in the background and carries on in the foreground", async () => {
    const { fake, held } = createHarness();
    fake.setForeground(false);

    held.pull(orwell);
    await held.idle();
    expect(fake.fetched()).toEqual([]);

    fake.setForeground(true);
    await held.idle();
    expect(fake.fetched()).toEqual(["orwell/intro", "orwell/book"]);
  });

  it("retries a Track the desktop couldn't serve on the next connection", async () => {
    const fake = createFakeHeldAudiobooksPlatform({
      serverUrl: "http://desktop",
      failingTrackIds: ["intro"],
    });
    const { held } = createHarness(fake);

    held.pull(orwell);
    await held.idle();
    expect(fake.fetched()).toEqual(["orwell/book"]);

    fake.healTrack("intro");
    fake.setServerUrl(null);
    fake.setServerUrl("http://desktop");
    await held.idle();
    expect(held.getHold("orwell")).toMatchObject({ complete: true });
  });

  it("removes a book from this phone: its files, its hold, and any fetch on the way", async () => {
    const fake = createFakeHeldAudiobooksPlatform({
      serverUrl: "http://desktop",
      gatedTrackIds: ["cd3-01"],
    });
    const { held } = createHarness(fake);
    held.pull(frankl);
    await fake.fetchStarted("cd3-01");

    await held.remove("frankl");
    fake.releaseTrack("cd3-01");
    await held.idle();

    expect(fake.files()).toEqual([]);
    expect(held.getHold("frankl")).toBeNull();
    expect(fake.storedRecords()).toEqual([]);
    await expect(held.trackUri("cd1-01")).resolves.toBeNull();
  });

  it("doesn't offer a held file that can't be reached now", async () => {
    const { fake, held } = createHarness();
    held.pull(orwell);
    await held.idle();

    fake.loseFile("file://storage/orwell/intro");

    await expect(held.trackUri("intro")).resolves.toBeNull();
    await expect(held.trackUri("book")).resolves.toBe(
      "file://storage/orwell/book",
    );
  });

  it("keeps a pulled book when the Mirror lets go of it", async () => {
    const { fake, held } = createHarness();
    held.pull(orwell);
    held.hold(orwell, "mirrored");
    held.hold(frankl, "mirrored");
    await held.idle();

    await held.release("orwell", "mirrored");
    await held.release("frankl", "mirrored");

    expect(held.getHold("orwell")).toMatchObject({
      reasons: ["pulled"],
      complete: true,
    });
    expect(held.getHold("frankl")).toBeNull();
    expect(fake.files().sort()).toEqual([
      "file://storage/orwell/book",
      "file://storage/orwell/intro",
    ]);
  });

  it("leaves a book the Mirror brought to the Mirror when it is played", async () => {
    const { held } = createHarness();
    held.hold(frankl, "mirrored");

    held.pull(frankl);
    await held.idle();
    await held.release("frankl", "mirrored");

    expect(held.getHold("frankl")).toBeNull();
  });

  it("keeps what it saved when a book is played while the app is starting", async () => {
    const fake = createFakeHeldAudiobooksPlatform({
      serverUrl: "http://desktop",
      storedRecords: [
        {
          book: orwell,
          reasons: ["mirrored"],
          trackUris: { intro: "file://storage/orwell/intro" },
          heldAt: 1,
        },
      ],
    });
    const { held } = createHarness(fake);

    held.pull(orwell);
    await held.idle();

    expect(held.getHold("orwell")).toMatchObject({
      reasons: ["mirrored"],
      complete: true,
    });
    expect(fake.fetched()).toEqual(["orwell/book"]);
  });

  it("fetches Tracks a Rescan added to a held book", async () => {
    const { fake, held } = createHarness();
    held.pull(orwell);
    await held.idle();

    held.refresh([
      { ...orwell, tracks: [...orwell.tracks, track("afterword")] },
      frankl,
    ]);
    await held.idle();

    expect(fake.fetched()).toEqual([
      "orwell/intro",
      "orwell/book",
      "orwell/afterword",
    ]);
    expect(held.getHold("frankl")).toBeNull();
  });
});
