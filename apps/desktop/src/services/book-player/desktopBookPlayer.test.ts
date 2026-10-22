import type { ListeningSave } from "../../../../shared/book-player/keepListeningPosition";
import type { AudiobookTrackPosition } from "../../../../shared/mobile-sync-contract";
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

// A Track never played: no Track position yet.
const notStarted = { resumeSeconds: null, playedToEnd: false, resumeUpdatedAt: null };

const frankl = (overrides: Partial<DesktopAudiobook> = {}): DesktopAudiobook => ({
  id: "frankl",
  title: "Man's Search for Meaning",
  author: "Viktor Frankl",
  coverPath: null,
  listeningTrackId: null,
  listeningSeconds: null,
  finished: false,
  tracks: [
    {
      id: "t1",
      filePath: "/books/Frankl/CD 1/Track 01.mp3",
      durationSeconds: 300,
      missing: false,
      ...notStarted,
    },
    {
      id: "t2",
      filePath: "/books/Frankl/CD 1/Track 02.mp3",
      durationSeconds: 300,
      missing: false,
      ...notStarted,
    },
    {
      id: "t3",
      filePath: "/books/Frankl/CD 2/Track 01.mp3",
      durationSeconds: 300,
      missing: false,
      ...notStarted,
    },
  ],
  ...overrides,
});

const TRACK_1 = "local-file:///books/Frankl/CD%201/Track%2001.mp3";
const TRACK_2 = "local-file:///books/Frankl/CD%201/Track%2002.mp3";
const TRACK_3 = "local-file:///books/Frankl/CD%202/Track%2001.mp3";

// The window's document, where every media element's play is heard.
const createFakePage = () => {
  const listeners: ((event: { target: unknown }) => void)[] = [];
  return {
    addEventListener: (_type: "play", listener: (event: { target: unknown }) => void) => {
      listeners.push(listener);
    },
    /** A Video on some page starts playing. */
    playVideo: () => {
      for (const listener of listeners) listener({ target: { nodeName: "VIDEO" } });
    },
  };
};

const setup = ({ savedSpeed = 1 }: { savedSpeed?: number } = {}) => {
  const audio = createFakeAudio();
  const page = createFakePage();
  const saves: ListeningSave[] = [];
  const speed = { saved: savedSpeed };
  const skipped: string[][] = [];
  const trackPositions: AudiobookTrackPosition[] = [];
  const startedOver: { audiobookId: string; at: number }[] = [];
  const player = createDesktopBookPlayer({
    audio,
    page,
    saveListening: (save) => saves.push(save),
    saveTrackPosition: (position) => trackPositions.push(position),
    saveStartOver: (audiobookId, at) => startedOver.push({ audiobookId, at }),
    speed: {
      get: () => speed.saved,
      set: (rate) => {
        speed.saved = rate;
      },
    },
  });
  player.onTracksSkipped((tracks) => skipped.push(tracks.map((track) => track.title)));
  return { audio, page, saves, speed, skipped, trackPositions, startedOver, player };
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

  it("skips a Track whose file can't be read, naming it", async () => {
    const { audio, skipped, player } = setup();
    await player.play(frankl());

    audio.fail();
    await player.settled();

    expect(audio.src).toBe(TRACK_2);
    expect(trackPlaying(player)).toBe("Track 02");
    expect(skipped).toEqual([["Track 01"]]);
  });

  it("skips Tracks gone after a Rescan when playback reaches them, naming them", async () => {
    const { audio, skipped, player } = setup();
    const book = frankl();
    book.tracks[1].missing = true;
    book.tracks[2].missing = true;
    await player.play(book);
    expect(skipped).toEqual([]);

    audio.finish();
    await player.settled();

    expect(player.getState().status).toBe("finished");
    expect(skipped).toEqual([["Track 02", "Track 01"]]);
  });

  it("plays a Track whose file name has # or ? in it", async () => {
    const { audio, skipped, player } = setup();
    const book = frankl();
    book.tracks[0].filePath = "/books/Frankl/Part #1 - Why?.mp3";

    await player.play(book);

    expect(audio.src).toBe("local-file:///books/Frankl/Part%20%231%20-%20Why%3F.mp3");
    expect(trackPlaying(player)).toBe("Part #1 - Why?");
    expect(skipped).toEqual([]);
  });

  it("pauses the book when a Video starts playing, and Play resumes it", async () => {
    const { audio, page, player } = setup();
    await player.play(frankl());

    page.playVideo();

    expect(audio.paused).toBe(true);
    expect(player.getState().status).toBe("paused");

    player.resume();
    expect(audio.paused).toBe(false);
    expect(player.getState().status).toBe("playing");
  });

  it("plays a picked Track never played from its start, and Start over from Track 1", async () => {
    const { audio, player } = setup();
    const book = frankl({ listeningTrackId: "t2", listeningSeconds: 754 });

    await player.jumpTo(book, 2);
    expect(audio.src).toBe(TRACK_3);

    await player.startOver(book);
    audio.ready();
    expect(audio.src).toBe(TRACK_1);
    expect(audio.currentTime).toBe(0);
  });

  it("resumes a picked Track from its Track position", async () => {
    const { audio, player } = setup();
    const book = frankl();
    book.tracks[1] = { ...book.tracks[1], resumeSeconds: 2400, resumeUpdatedAt: 1_000 };

    await player.jumpTo(book, 1);
    audio.ready(3000);

    expect(audio.src).toBe(TRACK_2);
    expect(audio.currentTime).toBe(2400);
  });

  it("plays a picked Track played to its end from 0", async () => {
    const { audio, player } = setup();
    const book = frankl();
    book.tracks[0] = {
      ...book.tracks[0],
      resumeSeconds: 300,
      playedToEnd: true,
      resumeUpdatedAt: 1_000,
    };

    await player.jumpTo(book, 0);
    audio.ready();

    expect(audio.src).toBe(TRACK_1);
    expect(audio.currentTime).toBe(0);
  });

  it("resumes Track 2 at 40:00 after jumping to another Track and back", async () => {
    const { audio, trackPositions, player } = setup();
    const book = frankl();
    await player.jumpTo(book, 1);
    audio.ready(3000);
    jest.setSystemTime(7_000);
    audio.playTo(2400);

    await player.jumpTo(book, 2);
    expect(trackPositions).toEqual([
      { audiobookId: "frankl", trackId: "t2", seconds: 2400, playedToEnd: false, updatedAt: 7_000 },
    ]);

    await player.jumpTo(book, 1);
    audio.ready(3000);
    expect(audio.src).toBe(TRACK_2);
    expect(audio.currentTime).toBe(2400);
  });

  it("saves a Track that played to its end as played to its end", async () => {
    const { audio, trackPositions, player } = setup();
    await player.play(frankl());
    audio.ready();
    audio.playTo(299.8);

    audio.finish();
    await player.settled();

    expect(trackPositions.at(-1)).toMatchObject({ trackId: "t1", playedToEnd: true });
  });

  it("plays the book from the Track last played, at that Track's own time", async () => {
    const { audio, player } = setup();
    const book = frankl({ listeningTrackId: "t2", listeningSeconds: 754 });
    book.tracks[1] = { ...book.tracks[1], resumeSeconds: 1200, resumeUpdatedAt: 2_000 };

    await player.play(book);
    audio.ready(3000);

    expect(audio.src).toBe(TRACK_2);
    expect(audio.currentTime).toBe(1200);
  });

  it("records Start over, and forgets the Track positions it knew", async () => {
    const { audio, startedOver, player } = setup();
    const book = frankl();
    await player.jumpTo(book, 1);
    audio.ready(3000);
    audio.playTo(2400);
    await player.jumpTo(book, 2);
    jest.setSystemTime(9_000);

    await player.startOver(book);
    expect(startedOver).toEqual([{ audiobookId: "frankl", at: 9_000 }]);

    await player.jumpTo(book, 1);
    audio.ready(3000);
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
