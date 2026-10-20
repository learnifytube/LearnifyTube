import type { ListeningSave } from "../../../../shared/book-player/keepListeningPosition";
import { createDesktopBookPlayer, type DesktopAudiobook } from "./desktopBookPlayer";

// An <audio> element as Chromium drives it, without the sound.
const createFakeAudio = () => {
  const events = new EventTarget();
  const fire = (type: string): void => {
    events.dispatchEvent(new Event(type));
  };
  let source = "";
  const audio = {
    currentTime: 0,
    duration: NaN,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    preservesPitch: true,
    paused: true,
    ended: false,
    get src(): string {
      return source;
    },
    // A new source loads from its start.
    set src(uri: string) {
      source = uri;
      audio.load();
    },
    play: (): Promise<void> => {
      audio.paused = false;
      audio.ended = false;
      fire("play");
      return Promise.resolve();
    },
    pause: (): void => {
      if (audio.paused) return;
      audio.paused = true;
      fire("pause");
    },
    load: (): void => {
      audio.currentTime = 0;
      audio.duration = NaN;
      audio.ended = false;
      audio.paused = true;
    },
    removeAttribute: (name: string): void => {
      if (name === "src") source = "";
    },
    addEventListener: (type: string, listener: () => void): void => {
      events.addEventListener(type, listener);
    },
    /** The loaded file is read far enough to play; it is `length` seconds long. */
    ready: (length = 300): void => {
      audio.duration = length;
      fire("durationchange");
      fire("loadedmetadata");
      fire("canplay");
    },
    /** Plays on to `seconds` into the loaded file. */
    playTo: (seconds: number): void => {
      audio.currentTime = seconds;
      fire("timeupdate");
    },
    /** Plays to the end of the loaded file: Chromium pauses, then ends. */
    finish: (): void => {
      audio.ended = true;
      audio.paused = true;
      fire("pause");
      fire("ended");
    },
    /** The loaded file can't be read (gone, or not audio). */
    fail: (): void => fire("error"),
  };
  return audio;
};

const frankl = (overrides: Partial<DesktopAudiobook> = {}): DesktopAudiobook => ({
  id: "frankl",
  title: "Man's Search for Meaning",
  author: "Viktor Frankl",
  coverPath: null,
  listeningTrackId: null,
  listeningSeconds: null,
  finished: false,
  tracks: [
    { id: "t1", filePath: "/books/Frankl/CD 1/Track 01.mp3", durationSeconds: 300, missing: false },
    { id: "t2", filePath: "/books/Frankl/CD 1/Track 02.mp3", durationSeconds: 300, missing: false },
    { id: "t3", filePath: "/books/Frankl/CD 2/Track 01.mp3", durationSeconds: 300, missing: false },
  ],
  ...overrides,
});

const TRACK_1 = "local-file:///books/Frankl/CD%201/Track%2001.mp3";
const TRACK_2 = "local-file:///books/Frankl/CD%201/Track%2002.mp3";
const TRACK_3 = "local-file:///books/Frankl/CD%202/Track%2001.mp3";

const setup = ({ savedSpeed = 1 }: { savedSpeed?: number } = {}) => {
  const audio = createFakeAudio();
  const saves: ListeningSave[] = [];
  const speed = { saved: savedSpeed };
  const player = createDesktopBookPlayer({
    audio,
    saveListening: (save) => saves.push(save),
    speed: {
      get: () => speed.saved,
      set: (rate) => {
        speed.saved = rate;
      },
    },
  });
  return { audio, saves, speed, player };
};

const trackPlaying = (player: ReturnType<typeof setup>["player"]) => {
  const state = player.getState();
  return "trackIndex" in state ? state.book.tracks[state.trackIndex].title : null;
};

describe("Desktop Book player", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("plays a book never listened to from its first Track, read from the book's folder", async () => {
    const { audio, player } = setup();

    await player.play(frankl());

    expect(audio.src).toBe(TRACK_1);
    expect(audio.paused).toBe(false);
    expect(player.getState().status).toBe("playing");
    expect(trackPlaying(player)).toBe("Track 01");
  });

  it("resumes from the Listening position once the Track can seek", async () => {
    const { audio, player } = setup();

    await player.play(frankl({ listeningTrackId: "t2", listeningSeconds: 754 }));
    audio.ready();

    expect(audio.src).toBe(TRACK_2);
    expect(audio.currentTime).toBe(754);
  });

  it("plays a finished book from the start", async () => {
    const { audio, player } = setup();

    await player.play(frankl({ listeningTrackId: "t3", listeningSeconds: 300, finished: true }));
    audio.ready();

    expect(audio.src).toBe(TRACK_1);
    expect(audio.currentTime).toBe(0);
  });

  it("carries on into the next Track when one ends", async () => {
    const { audio, player } = setup();
    await player.play(frankl());

    audio.finish();
    await player.settled();

    expect(audio.src).toBe(TRACK_2);
    expect(audio.paused).toBe(false);
    expect(player.getState().status).toBe("playing");
  });

  it("skips a Track whose file can't be read", async () => {
    const { audio, player } = setup();
    await player.play(frankl());

    audio.fail();
    await player.settled();

    expect(audio.src).toBe(TRACK_2);
    expect(trackPlaying(player)).toBe("Track 02");
  });

  it("plays a picked Track from its start, and Start over from Track 1", async () => {
    const { audio, player } = setup();
    const book = frankl({ listeningTrackId: "t2", listeningSeconds: 754 });

    await player.jumpTo(book, 2);
    expect(audio.src).toBe(TRACK_3);

    await player.startOver(book);
    audio.ready();
    expect(audio.src).toBe(TRACK_1);
    expect(audio.currentTime).toBe(0);
  });

  it("follows the media keys pausing and playing the audio", async () => {
    const { audio, player } = setup();
    await player.play(frankl());

    audio.pause();
    expect(player.getState().status).toBe("paused");

    await audio.play();
    expect(player.getState().status).toBe("playing");
  });

  it("saves the Listening position on pause, and every 15s while playing", async () => {
    const { audio, saves, player } = setup();
    await player.play(frankl());
    audio.ready();
    jest.setSystemTime(5_000);
    audio.currentTime = 42.5;

    player.pause();

    expect(saves.at(-1)).toEqual({
      moment: "meaningful",
      listening: {
        audiobookId: "frankl",
        trackId: "t1",
        seconds: 42.5,
        finished: false,
        updatedAt: 5_000,
      },
    });

    player.resume();
    saves.length = 0;
    jest.advanceTimersByTime(30_000);
    expect(saves.map((save) => save.moment)).toEqual(["periodic", "periodic"]);
  });

  it("saves a finished book when its last Track ends", async () => {
    const { audio, saves, player } = setup();
    await player.jumpTo(frankl(), 2);

    audio.finish();
    await player.settled();

    expect(player.getState().status).toBe("finished");
    expect(saves.at(-1)?.listening).toMatchObject({ trackId: "t3", finished: true });
  });

  it("plays at the speed remembered from last time, and remembers a new one", async () => {
    const { audio, speed, player } = setup({ savedSpeed: 1.5 });

    await player.play(frankl());
    expect(audio.playbackRate).toBe(1.5);

    player.setSpeed(1.25);
    expect(audio.playbackRate).toBe(1.25);
    expect(speed.saved).toBe(1.25);
  });

  it("shows how far into the Track the book is, and seeks within it", async () => {
    const { audio, player } = setup();
    expect(player.getProgress()).toEqual({ elapsed: 0, duration: 0 });

    await player.play(frankl());
    audio.ready(312);
    const changes: unknown[] = [];
    player.subscribeProgress(() => changes.push(player.getProgress()));
    audio.playTo(61.5);

    expect(changes).toEqual([{ elapsed: 61.5, duration: 312 }]);

    player.seekTo(200);
    expect(audio.currentTime).toBe(200);
    expect(player.getProgress()).toEqual({ elapsed: 200, duration: 312 });

    player.seekTo(999);
    expect(audio.currentTime).toBe(312);
  });

  it("shows the Track's known length until its file says how long it is", async () => {
    const { player } = setup();

    await player.play(frankl({ listeningTrackId: "t2", listeningSeconds: 754 }));

    expect(player.getProgress()).toEqual({ elapsed: 754, duration: 300 });
  });
});
