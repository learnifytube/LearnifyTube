import { createDesktopBookPlayer, type DesktopAudiobook } from "./desktopBookPlayer";
import { connectMediaSession, type MediaSessionOutput } from "./mediaSession";

// The parts of an <audio> element the Book player needs, without the sound.
const createSilentAudio = () => ({
  src: "",
  currentTime: 0,
  duration: NaN,
  playbackRate: 1,
  defaultPlaybackRate: 1,
  preservesPitch: true,
  paused: true,
  ended: false,
  play: () => Promise.resolve(),
  pause: () => undefined,
  load: () => undefined,
  removeAttribute: () => undefined,
  addEventListener: () => undefined,
});

// What the OS media controls and the media keys see of the app.
const createFakeMediaSession = () => {
  const handlers = new Map<string, (details: MediaSessionActionDetails) => void>();
  const session: MediaSessionOutput & {
    press: (action: MediaSessionAction, details?: Partial<MediaSessionActionDetails>) => void;
  } = {
    metadata: null,
    playbackState: "none",
    setActionHandler: (action, handler) => {
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
    },
    press: (action, details = {}) => handlers.get(action)?.({ action, ...details }),
  };
  return session;
};

const book: DesktopAudiobook = {
  id: "frankl",
  title: "Man's Search for Meaning",
  author: "Viktor Frankl",
  coverPath: "/covers/frankl.jpg",
  listeningTrackId: null,
  listeningSeconds: null,
  finished: false,
  tracks: [
    { id: "t1", filePath: "/books/Frankl/Track 01.mp3", durationSeconds: 300, missing: false },
    { id: "t2", filePath: "/books/Frankl/Track 02.mp3", durationSeconds: 300, missing: false },
  ].map((track) => ({ ...track, resumeSeconds: null, playedToEnd: false, resumeUpdatedAt: null })),
};

const setup = () => {
  const audio = createSilentAudio();
  const player = createDesktopBookPlayer({
    audio,
    page: { addEventListener: () => undefined },
    saveListening: () => undefined,
    saveTrackPosition: () => undefined,
    saveStartOver: () => undefined,
  });
  const session = createFakeMediaSession();
  connectMediaSession(player, session, (metadata) => metadata);
  return { audio, player, session };
};

describe("Book player in the OS media controls", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows the book and its Track while it plays", async () => {
    const { session, player } = setup();
    expect(session.metadata).toBeNull();

    await player.play(book);

    expect(session.metadata).toEqual({
      title: "Track 01",
      artist: "Viktor Frankl",
      album: "Man's Search for Meaning",
      artwork: [{ src: "local-file:///covers/frankl.jpg" }],
    });
    expect(session.playbackState).toBe("playing");
  });

  it("lets the media keys pause, play, and move between Tracks", async () => {
    const { session, player } = setup();
    await player.play(book);

    session.press("pause");
    expect(player.getState().status).toBe("paused");
    expect(session.playbackState).toBe("paused");

    session.press("play");
    expect(player.getState().status).toBe("playing");

    session.press("nexttrack");
    await player.settled();
    expect(session.metadata).toMatchObject({ title: "Track 02" });
  });

  it("seeks from the OS controls", async () => {
    const { audio, session, player } = setup();
    await player.play(book);

    session.press("seekto", { seekTime: 120 });
    expect(audio.currentTime).toBe(120);

    session.press("seekforward");
    expect(audio.currentTime).toBe(150);
  });

  it("clears the controls once the book is finished", async () => {
    const { session, player } = setup();
    await player.jumpTo(book, 1);

    await player.nextTrack();

    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
  });
});
