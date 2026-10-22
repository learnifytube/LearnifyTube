import { createDesktopBookPlayer, type DesktopAudiobook } from "./desktopBookPlayer";
import { handleBookPlayerKey, type BookPlayerKeyEvent } from "./spaceKey";

const silentAudio = () => ({
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

const book: DesktopAudiobook = {
  id: "frankl",
  title: "Man's Search for Meaning",
  author: null,
  coverPath: null,
  listeningTrackId: null,
  listeningSeconds: null,
  finished: false,
  tracks: [
    {
      id: "t1",
      filePath: "/books/Frankl/01.mp3",
      durationSeconds: 300,
      missing: false,
      resumeSeconds: null,
      playedToEnd: false,
      resumeUpdatedAt: null,
    },
  ],
};

// A key press with focus on the page itself, unless `target` says otherwise.
const press = (overrides: Partial<BookPlayerKeyEvent> = {}) => {
  const event = {
    key: " ",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: { tagName: "BODY", isContentEditable: false, getAttribute: () => null },
    preventDefault: () => {
      event.defaultPrevented = true;
    },
    ...overrides,
  };
  return event;
};

const setup = () => {
  const player = createDesktopBookPlayer({
    audio: silentAudio(),
    page: { addEventListener: () => undefined },
    saveListening: () => undefined,
    saveTrackPosition: () => undefined,
    saveStartOver: () => undefined,
  });
  return { player };
};

describe("Space toggles the Book player", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("pauses a playing book and plays it again, instead of scrolling the page", async () => {
    const { player } = setup();
    await player.play(book);

    const first = press();
    handleBookPlayerKey(first, player);
    expect(player.getState().status).toBe("paused");
    expect(first.defaultPrevented).toBe(true);

    handleBookPlayerKey(press(), player);
    expect(player.getState().status).toBe("playing");
  });

  it("leaves Space alone while typing, on a focused control, or with a modifier", async () => {
    const { player } = setup();
    await player.play(book);

    const typing = [
      { tagName: "INPUT", isContentEditable: false, getAttribute: () => null },
      { tagName: "TEXTAREA", isContentEditable: false, getAttribute: () => null },
      { tagName: "DIV", isContentEditable: true, getAttribute: () => null },
      { tagName: "BUTTON", isContentEditable: false, getAttribute: () => null },
      { tagName: "DIV", isContentEditable: false, getAttribute: () => "slider" },
    ];
    for (const target of typing) handleBookPlayerKey(press({ target }), player);
    handleBookPlayerKey(press({ shiftKey: true }), player);
    handleBookPlayerKey(press({ repeat: true }), player);

    expect(player.getState().status).toBe("playing");
  });

  it("leaves Space to a Video player on the page", async () => {
    const { player } = setup();
    await player.play(book);

    handleBookPlayerKey(press({ defaultPrevented: true }), player);
    handleBookPlayerKey(press(), player, { videoOnPage: true });

    expect(player.getState().status).toBe("playing");
  });

  it("does nothing, and lets the page scroll, while no book is in the player", () => {
    const { player } = setup();
    const event = press();

    handleBookPlayerKey(event, player);

    expect(player.getState().status).toBe("idle");
    expect(event.defaultPrevented).toBe(false);
  });
});
