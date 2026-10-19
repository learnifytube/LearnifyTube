import { createBookPlayer, type Book } from "./createBookPlayer";
import { createFakeBookAudioPlatform } from "./fakeBookAudioPlatform";

const track = (id: string, missing = false) => ({
  id,
  title: `Track ${id}`,
  durationSeconds: 300,
  missing,
});

const frankl: Book = {
  id: "frankl",
  title: "Man's Search for Meaning",
  author: "Viktor Frankl",
  coverUrl: "http://desktop/api/audiobook/frankl/cover",
  tracks: [track("cd1-01"), track("cd1-02"), track("cd3-01")],
};

function createHarness(
  options?: Parameters<typeof createFakeBookAudioPlatform>[0],
) {
  const audio = createFakeBookAudioPlatform(options);
  const player = createBookPlayer(audio.platform);
  return { audio, player };
}

describe("Book player", () => {
  it("starts a book at its first Track and plays it", async () => {
    const { audio, player } = createHarness();

    await player.play(frankl);

    expect(audio.current()).toEqual({
      uri: "stream://cd1-01",
      startAt: 0,
      nowPlaying: {
        bookTitle: "Man's Search for Meaning",
        trackTitle: "Track cd1-01",
        author: "Viktor Frankl",
        coverUrl: "http://desktop/api/audiobook/frankl/cover",
      },
    });
    expect(audio.isPlaying()).toBe(true);
    expect(player.getState()).toEqual({
      status: "playing",
      book: frankl,
      trackIndex: 0,
    });
  });

  it("plays the next Track from its start when a Track ends", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);

    audio.finishTrack();
    await player.settled();

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-02",
      startAt: 0,
      nowPlaying: { trackTitle: "Track cd1-02" },
    });
    expect(audio.isPlaying()).toBe(true);
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 1,
    });
  });

  it("plays every Track in Track order and finishes after the last one", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);

    for (let i = 0; i < frankl.tracks.length; i++) {
      audio.finishTrack();
      await player.settled();
    }

    expect(audio.loadedUris()).toEqual([
      "stream://cd1-01",
      "stream://cd1-02",
      "stream://cd3-01",
    ]);
    expect(audio.isPlaying()).toBe(false);
    expect(player.getState()).toEqual({ status: "finished", book: frankl });
  });

  it("skips missing Tracks, at the start and between Tracks", async () => {
    const book: Book = {
      ...frankl,
      tracks: [
        track("gone-1", true),
        track("a"),
        track("gone-2", true),
        track("gone-3", true),
        track("b"),
      ],
    };
    const { audio, player } = createHarness();

    await player.play(book);
    expect(player.getState()).toMatchObject({ trackIndex: 1 });
    audio.finishTrack();
    await player.settled();

    expect(audio.loadedUris()).toEqual(["stream://a", "stream://b"]);
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 4,
    });
  });

  it("finishes when only missing Tracks are left", async () => {
    const book: Book = {
      ...frankl,
      tracks: [track("a"), track("gone", true)],
    };
    const { audio, player } = createHarness();
    await player.play(book);

    audio.finishTrack();
    await player.settled();

    expect(audio.loadedUris()).toEqual(["stream://a"]);
    expect(player.getState()).toEqual({ status: "finished", book });
  });

  it("pauses and resumes the Track playing", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);

    player.pause();
    expect(audio.isPlaying()).toBe(false);
    expect(player.getState()).toMatchObject({
      status: "paused",
      trackIndex: 0,
    });

    player.resume();
    expect(audio.isPlaying()).toBe(true);
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 0,
    });
    expect(audio.loadedUris()).toEqual(["stream://cd1-01"]);
  });

  it("stops at a Track it can't play now, without skipping it", async () => {
    const { audio, player } = createHarness({
      unavailableTrackIds: ["cd1-02"],
    });
    await player.play(frankl);

    audio.finishTrack();
    await player.settled();

    expect(audio.current()).toBeNull();
    expect(player.getState()).toEqual({
      status: "unavailable",
      book: frankl,
      trackIndex: 1,
    });
  });

  it("tells listeners about every change", async () => {
    const { audio, player } = createHarness();
    const statuses: string[] = [];
    const unsubscribe = player.subscribe(() =>
      statuses.push(player.getState().status),
    );

    await player.play(frankl);
    player.pause();
    player.resume();
    for (let i = 0; i < frankl.tracks.length; i++) {
      audio.finishTrack();
      await player.settled();
    }
    unsubscribe();
    await player.play(frankl);

    expect(statuses).toEqual([
      "playing",
      "paused",
      "playing",
      "playing",
      "playing",
      "finished",
    ]);
  });

  it("resumes mid-Track from a Listening position, then carries on to the end", async () => {
    const { audio, player } = createHarness();

    await player.play(frankl, { trackId: "cd1-02", seconds: 754 });

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-02",
      startAt: 754,
    });
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 1,
    });

    audio.finishTrack();
    await player.settled();
    expect(audio.current()).toMatchObject({
      uri: "stream://cd3-01",
      startAt: 0,
    });
  });

  it("starts at Track 1 when the Listening position's Track is no longer in the book", async () => {
    const { audio, player } = createHarness();

    await player.play(frankl, { trackId: "gone", seconds: 754 });

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-01",
      startAt: 0,
    });
  });

  it("resumes at the next Track when the Listening position's Track went missing", async () => {
    const book: Book = {
      ...frankl,
      tracks: [track("a"), track("b", true), track("c")],
    };
    const { audio, player } = createHarness();

    await player.play(book, { trackId: "b", seconds: 754 });

    expect(audio.current()).toMatchObject({ uri: "stream://c", startAt: 0 });
  });

  it("jumps to a chosen Track from its start", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl, { trackId: "cd1-02", seconds: 754 });

    await player.jumpTo(frankl, 2);

    expect(audio.current()).toMatchObject({
      uri: "stream://cd3-01",
      startAt: 0,
    });
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 2,
    });
  });

  it("starts over at Track 1, 0:00", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl, { trackId: "cd3-01", seconds: 100 });

    await player.startOver(frankl);

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-01",
      startAt: 0,
    });
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 0,
    });
  });

  it("tells where in the book the listener is, to keep as the Listening position", async () => {
    const { audio, player } = createHarness();
    expect(player.listeningPosition()).toBeNull();

    await player.play(frankl, { trackId: "cd1-02", seconds: 754 });
    audio.setTime(800);
    player.pause();

    expect(player.listeningPosition()).toEqual({
      audiobookId: "frankl",
      trackId: "cd1-02",
      seconds: 800,
      finished: false,
    });
  });

  it("is finished at the end of the last Track", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl, { trackId: "cd3-01", seconds: 100 });

    audio.finishTrack();
    await player.settled();

    expect(player.getState()).toEqual({ status: "finished", book: frankl });
    expect(player.listeningPosition()).toEqual({
      audiobookId: "frankl",
      trackId: "cd3-01",
      seconds: 300,
      finished: true,
    });
  });

  it("has no Listening position to keep while a Track can't play", async () => {
    const { player } = createHarness({ unavailableTrackIds: ["cd1-02"] });

    await player.play(frankl, { trackId: "cd1-02", seconds: 754 });

    expect(player.getState()).toMatchObject({ status: "unavailable" });
    expect(player.listeningPosition()).toBeNull();
  });

  it("plays only the book tapped last when a Track is slow to resolve", async () => {
    const orwell: Book = { ...frankl, id: "orwell", tracks: [track("1984")] };
    const { audio, player } = createHarness({ slowTrackIds: ["cd1-01"] });

    const first = player.play(frankl);
    await player.play(orwell);
    audio.releaseSlowTracks();
    await first;

    expect(audio.loadedUris()).toEqual(["stream://1984"]);
    expect(player.getState()).toMatchObject({
      status: "playing",
      book: orwell,
    });
  });
});
