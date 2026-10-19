import { createBookPlayer, type Book } from "./createBookPlayer";
import { createFakeBookAudioPlatform } from "./fakeBookAudioPlatform";

// Book player controls for listening with the screen off: ±30s across Track
// boundaries, speed, interruptions from the system, and Tracks that never load.

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

describe("Book player skipping ±30s", () => {
  it("skips forward and back within the Track playing", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);
    audio.setTime(100);

    await player.skip(30);
    expect(audio.time()).toBe(130);

    await player.skip(-30);
    await player.skip(-30);
    expect(audio.time()).toBe(70);
    expect(audio.loadedUris()).toEqual(["stream://cd1-01"]);
  });

  it("skips back from the start of a Track into the end of the previous one", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);
    audio.finishTrack();
    await player.settled();
    audio.setTime(10);

    await player.skip(-30);

    // cd1-01 is 300s long: 20s before the start of cd1-02 is 280s into it.
    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-01",
      startAt: 280,
    });
    expect(audio.isPlaying()).toBe(true);
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 0,
    });
  });

  it("skips forward past the end of a Track into the next one", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);
    audio.setTime(290);

    await player.skip(30);

    expect(audio.current()).toMatchObject({
      uri: "stream://cd1-02",
      startAt: 20,
    });
    expect(player.getState()).toMatchObject({ trackIndex: 1 });
  });

  it("skips over missing Tracks when crossing a boundary", async () => {
    const book: Book = {
      ...frankl,
      tracks: [track("a"), track("gone", true), track("b")],
    };
    const { audio, player } = createHarness();
    await player.play(book);
    audio.finishTrack();
    await player.settled();
    audio.setTime(5);

    await player.skip(-30);

    expect(audio.current()).toMatchObject({ uri: "stream://a", startAt: 275 });
    expect(player.getState()).toMatchObject({ trackIndex: 0 });
  });

  it("goes back to the start of the book when skipping back in its first Track", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);
    audio.setTime(12);

    await player.skip(-30);

    expect(audio.time()).toBe(0);
    expect(audio.loadedUris()).toEqual(["stream://cd1-01"]);
  });

  it("finishes the book when skipping forward past the end of the last Track", async () => {
    const book: Book = { ...frankl, tracks: [track("only")] };
    const { audio, player } = createHarness();
    await player.play(book);
    audio.setTime(290);

    await player.skip(30);

    expect(audio.isPlaying()).toBe(false);
    expect(player.getState()).toEqual({ status: "finished", book });
  });

  it("starts the previous Track from its start when its length is unknown", async () => {
    const book: Book = {
      ...frankl,
      tracks: [{ ...track("a"), durationSeconds: null }, track("b")],
    };
    const { audio, player } = createHarness();
    await player.play(book);
    audio.finishTrack();
    await player.settled();
    audio.setTime(10);

    await player.skip(-30);

    expect(audio.current()).toMatchObject({ uri: "stream://a", startAt: 0 });
  });

  it("stays paused when a skip crosses into another Track while paused", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);
    audio.setTime(290);
    player.pause();

    await player.skip(30);

    expect(audio.current()).toMatchObject({ uri: "stream://cd1-02" });
    expect(audio.isPlaying()).toBe(false);
    expect(player.getState()).toMatchObject({
      status: "paused",
      trackIndex: 1,
    });
  });

  it("does nothing when no book is playing", async () => {
    const { audio, player } = createHarness();

    await player.skip(30);

    expect(audio.current()).toBeNull();
    expect(player.getState()).toEqual({ status: "idle" });
  });
});

describe("Book player speed", () => {
  // A remembered speed, like the persisted store the app passes in.
  function createSpeedMemory(initial: number) {
    let saved = initial;
    return { get: () => saved, set: (rate: number) => (saved = rate) };
  }

  it("plays at normal speed until a speed is chosen", async () => {
    const { audio, player } = createHarness();

    await player.play(frankl);

    expect(audio.rate()).toBe(1);
    expect(player.getSpeed()).toBe(1);
  });

  it("applies a chosen speed to the Track playing and every Track after it", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);

    player.setSpeed(1.5);
    expect(audio.rate()).toBe(1.5);

    audio.finishTrack();
    await player.settled();
    expect(audio.current()).toMatchObject({ uri: "stream://cd1-02" });
    expect(audio.rate()).toBe(1.5);

    audio.setTime(5);
    await player.skip(-30);
    expect(audio.current()).toMatchObject({ uri: "stream://cd1-01" });
    expect(audio.rate()).toBe(1.5);
  });

  it("remembers the chosen speed for the next book and the next app start", async () => {
    const memory = createSpeedMemory(1);
    const audio = createFakeBookAudioPlatform();
    const player = createBookPlayer(audio.platform, { speed: memory });
    await player.play(frankl);

    player.setSpeed(1.25);
    expect(memory.get()).toBe(1.25);

    const nextStart = createFakeBookAudioPlatform();
    const restarted = createBookPlayer(nextStart.platform, { speed: memory });
    await restarted.play(frankl);
    expect(nextStart.rate()).toBe(1.25);
    expect(restarted.getSpeed()).toBe(1.25);
  });

  it("keeps speed between 0.75× and 2×", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);

    player.setSpeed(3);
    expect(audio.rate()).toBe(2);

    player.setSpeed(0.5);
    expect(audio.rate()).toBe(0.75);
    expect(player.getSpeed()).toBe(0.75);
  });

  it("tells listeners when the speed changes", async () => {
    const { player } = createHarness();
    const speeds: number[] = [];
    player.subscribe(() => speeds.push(player.getSpeed()));

    player.setSpeed(1.75);

    expect(speeds).toEqual([1.75]);
  });
});

describe("Book player interruptions", () => {
  it("is paused when the system pauses the audio (a call, another app, headphones unplugged)", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);

    audio.pauseFromSystem();

    expect(player.getState()).toMatchObject({
      status: "paused",
      trackIndex: 0,
    });
  });

  it("is playing again when the system resumes the audio (call ended, lock-screen play)", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);
    audio.pauseFromSystem();

    audio.resumeFromSystem();

    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 0,
    });
  });

  it("follows lock-screen play after pausing in the app", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);
    player.pause();

    audio.resumeFromSystem();

    expect(player.getState()).toMatchObject({ status: "playing" });
  });

  it("ignores the system once the book has finished", async () => {
    const book: Book = { ...frankl, tracks: [track("only")] };
    const { audio, player } = createHarness();
    await player.play(book);
    audio.finishTrack();
    await player.settled();

    audio.pauseFromSystem();
    audio.resumeFromSystem();

    expect(player.getState()).toEqual({ status: "finished", book });
  });
});

describe("Book player Tracks that don't play", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("skips a Track whose file fails to load", async () => {
    const { audio, player } = createHarness();
    await player.play(frankl);

    audio.failTrack();
    await player.settled();

    expect(audio.current()).toMatchObject({ uri: "stream://cd1-02" });
    expect(audio.isPlaying()).toBe(true);
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 1,
    });
  });

  it("skips a Track that hasn't started loading after 20 seconds", async () => {
    jest.useFakeTimers();
    const { audio, player } = createHarness({ stallingTrackIds: ["cd1-01"] });
    await player.play(frankl);

    jest.advanceTimersByTime(19_000);
    expect(audio.current()).toMatchObject({ uri: "stream://cd1-01" });

    jest.advanceTimersByTime(1_000);
    await player.settled();
    expect(audio.current()).toMatchObject({ uri: "stream://cd1-02" });
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 1,
    });
  });

  it("keeps a slow Track that loads in time", async () => {
    jest.useFakeTimers();
    const { audio, player } = createHarness({ stallingTrackIds: ["cd1-01"] });
    await player.play(frankl);

    jest.advanceTimersByTime(15_000);
    audio.finishLoading();
    jest.advanceTimersByTime(60_000);
    await player.settled();

    expect(audio.loadedUris()).toEqual(["stream://cd1-01"]);
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 0,
    });
  });

  it("stops at the second Track in a row that doesn't play, instead of rushing to the end", async () => {
    jest.useFakeTimers();
    const { audio, player } = createHarness({
      stallingTrackIds: ["cd1-01", "cd1-02"],
    });
    await player.play(frankl);

    jest.advanceTimersByTime(20_000);
    await player.settled();
    jest.advanceTimersByTime(20_000);
    await player.settled();

    expect(audio.current()).toBeNull();
    expect(player.getState()).toEqual({
      status: "unavailable",
      book: frankl,
      trackIndex: 1,
    });
  });

  it("skips again after a Track in between played", async () => {
    const book: Book = {
      ...frankl,
      tracks: [track("a"), track("b"), track("c"), track("d")],
    };
    const { audio, player } = createHarness();
    await player.play(book);
    audio.failTrack();
    await player.settled();
    audio.finishTrack();
    await player.settled();

    audio.failTrack();
    await player.settled();

    expect(audio.loadedUris()).toEqual([
      "stream://a",
      "stream://b",
      "stream://c",
      "stream://d",
    ]);
    expect(player.getState()).toMatchObject({
      status: "playing",
      trackIndex: 3,
    });
  });

  it("doesn't skip the book tapped next when the last one's Track stalled", async () => {
    jest.useFakeTimers();
    const orwell: Book = { ...frankl, id: "orwell", tracks: [track("1984")] };
    const { audio, player } = createHarness({ stallingTrackIds: ["cd1-01"] });
    await player.play(frankl);
    jest.advanceTimersByTime(10_000);

    await player.play(orwell);
    jest.advanceTimersByTime(60_000);
    await player.settled();

    expect(audio.loadedUris()).toEqual(["stream://cd1-01", "stream://1984"]);
    expect(player.getState()).toMatchObject({
      status: "playing",
      book: orwell,
    });
  });
});
