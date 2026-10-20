import {
  createBookPlayer,
  type Book,
} from "../../../shared/book-player/createBookPlayer";
import { createFakeBookAudioPlatform } from "../../../shared/book-player/fakeBookAudioPlatform";
import {
  keepListeningPosition,
  type ListeningSave,
} from "../../../shared/book-player/keepListeningPosition";

// The listening keeper tells its reporter each save, and whether it is a
// meaningful moment (play, pause, Track change, finish) or a periodic save.

const track = (id: string) => ({
  id,
  title: `Track ${id}`,
  durationSeconds: 300,
  missing: false,
});

const frankl: Book = {
  id: "frankl",
  title: "Man's Search for Meaning",
  author: "Viktor Frankl",
  coverUrl: null,
  tracks: [track("cd1-01"), track("cd1-02")],
};

function createHarness() {
  const audio = createFakeBookAudioPlatform();
  const player = createBookPlayer(audio.platform);
  const saves: ListeningSave[] = [];
  const stop = keepListeningPosition(player, (save) => saves.push(save));
  return { audio, player, saves, stop };
}

beforeEach(() => {
  jest.useFakeTimers({ now: 1_000_000 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Listening keeper", () => {
  it("saves a meaningful moment when a book starts playing", async () => {
    const { player, saves } = createHarness();

    await player.play(frankl);

    expect(saves.at(-1)).toEqual({
      listening: {
        audiobookId: "frankl",
        trackId: "cd1-01",
        seconds: 0,
        finished: false,
        updatedAt: 1_000_000,
      },
      moment: "meaningful",
    });
    expect(saves.every((save) => save.moment === "meaningful")).toBe(true);
  });

  it("saves periodically every 15 seconds while playing", async () => {
    const { audio, player, saves } = createHarness();
    await player.play(frankl);
    const before = saves.length;

    audio.setTime(15);
    jest.advanceTimersByTime(15_000);

    expect(saves.slice(before)).toEqual([
      {
        listening: {
          audiobookId: "frankl",
          trackId: "cd1-01",
          seconds: 15,
          finished: false,
          updatedAt: 1_015_000,
        },
        moment: "periodic",
      },
    ]);
  });

  it("saves a meaningful moment on pause and no periodic saves while paused", async () => {
    const { audio, player, saves } = createHarness();
    await player.play(frankl);
    audio.setTime(42);
    const before = saves.length;

    player.pause();
    jest.advanceTimersByTime(60_000);

    expect(saves.slice(before)).toEqual([
      {
        listening: expect.objectContaining({ seconds: 42, finished: false }),
        moment: "meaningful",
      },
    ]);
  });

  it("saves a meaningful moment when the next Track starts", async () => {
    const { audio, player, saves } = createHarness();
    await player.play(frankl);
    const before = saves.length;

    audio.finishTrack();
    await player.settled();

    const changed = saves
      .slice(before)
      .filter((save) => save.listening.trackId === "cd1-02");
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((save) => save.moment === "meaningful")).toBe(true);
  });

  it("saves the finish as a meaningful moment", async () => {
    const { audio, player, saves } = createHarness();
    await player.jumpTo(frankl, 1);

    audio.finishTrack();
    await player.settled();

    expect(saves.at(-1)).toEqual({
      listening: expect.objectContaining({
        trackId: "cd1-02",
        seconds: 300,
        finished: true,
      }),
      moment: "meaningful",
    });
  });

  it("stops saving once stopped", async () => {
    const { audio, player, saves, stop } = createHarness();
    await player.play(frankl);
    const before = saves.length;

    stop();
    audio.setTime(20);
    jest.advanceTimersByTime(30_000);
    player.pause();

    expect(saves.length).toBe(before);
  });
});
