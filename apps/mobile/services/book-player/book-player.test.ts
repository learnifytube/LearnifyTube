import {
  createBookPlayer,
  type Book,
} from "../../../shared/book-player/createBookPlayer";
import { createFakeBookAudioPlatform } from "../../../shared/book-player/fakeBookAudioPlatform";

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
        bookId: "frankl",
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

describe("Book player, local first", () => {
  it("plays Tracks held on the phone from the phone and Streams the rest", async () => {
    const { audio, player } = createHarness({
      heldTrackIds: ["cd1-01", "cd3-01"],
    });
    await player.play(frankl);

    audio.finishTrack();
    await player.settled();
    audio.finishTrack();
    await player.settled();

    expect(audio.loadedUris()).toEqual([
      "file://held/cd1-01",
      "stream://cd1-02",
      "file://held/cd3-01",
    ]);
  });

  it("plays a held book start to end with no desktop", async () => {
    const { audio, player } = createHarness({
      desktop: false,
      heldTrackIds: ["cd1-01", "cd1-02", "cd3-01"],
    });
    await player.play(frankl);
    for (let i = 0; i < frankl.tracks.length; i++) {
      audio.finishTrack();
      await player.settled();
    }

    expect(audio.loadedUris()).toEqual([
      "file://held/cd1-01",
      "file://held/cd1-02",
      "file://held/cd3-01",
    ]);
    expect(player.getState()).toEqual({ status: "finished", book: frankl });
  });

  it("stops at a Track not on the phone yet when there is no desktop", async () => {
    const { audio, player } = createHarness({
      desktop: false,
      heldTrackIds: ["cd1-01"],
    });
    await player.play(frankl);

    audio.finishTrack();
    await player.settled();

    expect(player.getState()).toMatchObject({
      status: "unavailable",
      trackIndex: 1,
    });
  });

  it("uses a Track that reached the phone while the one before it played", async () => {
    const held: string[] = [];
    const { audio, player } = createHarness({ heldTrackIds: held });
    await player.play(frankl);

    held.push("cd1-02");
    audio.finishTrack();
    await player.settled();

    expect(audio.loadedUris()).toEqual([
      "stream://cd1-01",
      "file://held/cd1-02",
    ]);
  });
});

describe("Book player Track positions", () => {
  const withPositions = (
    positions: Record<string, { seconds: number; playedToEnd: boolean }>,
  ): Book => ({
    ...frankl,
    tracks: frankl.tracks.map((t) => ({
      ...t,
      trackPosition: positions[t.id]
        ? { ...positions[t.id], updatedAt: 1_000 }
        : null,
    })),
  });

  it("resumes a picked Track from its Track position", async () => {
    const book = withPositions({
      "cd1-02": { seconds: 120, playedToEnd: false },
    });
    const { audio, player } = createHarness();

    await player.jumpTo(book, 1);

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-02",
      startAt: 120,
    });
  });

  it("starts a picked Track played to its end from 0", async () => {
    const book = withPositions({
      "cd1-02": { seconds: 300, playedToEnd: true },
    });
    const { audio, player } = createHarness();

    await player.jumpTo(book, 1);

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-02",
      startAt: 0,
    });
  });

  it("goes back to where a Track was left when it is picked again", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);
    audio.setTime(95);

    await player.jumpTo(frankl, 2);
    await player.jumpTo(frankl, 0);

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-01",
      startAt: 95,
    });
  });

  it("starts a Track it played to its end from 0 when picked again", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl, { trackId: "cd1-01", seconds: 200 });
    audio.setTime(300);
    audio.finishTrack();
    await player.settled();

    await player.jumpTo(frankl, 0);

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-01",
      startAt: 0,
    });
  });

  it("tells each Track position as playback leaves the Track", async () => {
    jest.useFakeTimers({ now: 5_000 });
    const { audio, player } = createHarness();
    const positions: unknown[] = [];
    player.onTrackPosition((position) => positions.push(position));
    await player.play(frankl);
    audio.setTime(40);
    await player.jumpTo(frankl, 2);
    audio.setTime(300);
    audio.finishTrack();
    await player.settled();
    jest.useRealTimers();

    expect(positions).toEqual([
      {
        audiobookId: "frankl",
        trackId: "cd1-01",
        seconds: 40,
        playedToEnd: false,
        updatedAt: 5_000,
      },
      {
        audiobookId: "frankl",
        trackId: "cd3-01",
        seconds: 300,
        playedToEnd: true,
        updatedAt: 5_000,
      },
    ]);
  });

  it("starts every Track from 0 after Start over", async () => {
    const book = withPositions({
      "cd1-01": { seconds: 50, playedToEnd: false },
      "cd1-02": { seconds: 120, playedToEnd: false },
    });
    const { audio, player } = createHarness();
    await player.startOver(book);

    await player.jumpTo(book, 1);

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-02",
      startAt: 0,
    });
  });

  it("resumes the book's Track from that Track's own position", async () => {
    const book = withPositions({
      "cd1-02": { seconds: 120, playedToEnd: false },
    });
    const { audio, player } = createHarness();

    await player.play(book, { trackId: "cd1-02", seconds: 60 });

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-02",
      startAt: 120,
    });
  });
});
