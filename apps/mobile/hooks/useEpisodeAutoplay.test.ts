import { renderHook } from "@testing-library/react-native";
import type { Episode, Series } from "../../shared/mobile-sync-contract";
import { useEpisodeAutoplay, type EndingPlayer } from "./useEpisodeAutoplay";

const episode = (id: string, overrides: Partial<Episode> = {}): Episode => ({
  id,
  title: id,
  number: null,
  durationSeconds: 1000,
  missing: false,
  captions: [],
  watch: null,
  ...overrides,
});

const office: Series = {
  id: "office",
  title: "The Office",
  posterUrl: null,
  seasons: [
    {
      id: "s1",
      title: "Season 1",
      number: 1,
      sentToDevices: false,
      episodes: [
        episode("e1"),
        episode("e2", { missing: true }),
        episode("e3"),
      ],
    },
  ],
};

// A player that ends when told to, holding a file of `duration` seconds (0 when empty).
function fakePlayer(duration: number) {
  const ended = new Set<() => void>();
  const player: EndingPlayer = {
    duration,
    addListener: (_event, listener) => {
      ended.add(listener);
      return { remove: () => ended.delete(listener) };
    },
  };
  return {
    player,
    end: () => ended.forEach((listener) => listener()),
  };
}

describe("Episode autoplay", () => {
  it("opens the next Episode that can play when one ends", async () => {
    const { player, end } = fakePlayer(1000);
    const open = jest.fn();

    await renderHook(() =>
      useEpisodeAutoplay(player, {
        series: office,
        id: "e1",
        hasSource: true,
        open,
      }),
    );
    end();

    expect(open).toHaveBeenCalledWith("e3");
  });

  it("opens nothing after the last Episode", async () => {
    const { player, end } = fakePlayer(1000);
    const open = jest.fn();

    await renderHook(() =>
      useEpisodeAutoplay(player, {
        series: office,
        id: "e3",
        hasSource: true,
        open,
      }),
    );
    end();

    expect(open).not.toHaveBeenCalled();
  });

  it("opens nothing when the player ends before a source is loaded", async () => {
    // Android reports an empty player as ended.
    const empty = fakePlayer(0);
    const waiting = fakePlayer(0);
    const open = jest.fn();

    await renderHook(() =>
      useEpisodeAutoplay(empty.player, {
        series: office,
        id: "e1",
        hasSource: false,
        open,
      }),
    );
    await renderHook(() =>
      useEpisodeAutoplay(waiting.player, {
        series: office,
        id: "e1",
        hasSource: true,
        open,
      }),
    );
    empty.end();
    waiting.end();

    expect(open).not.toHaveBeenCalled();
  });

  it("does nothing for a Movie", async () => {
    const { player, end } = fakePlayer(1000);
    const open = jest.fn();

    await renderHook(() =>
      useEpisodeAutoplay(player, {
        series: null,
        id: "up",
        hasSource: true,
        open,
      }),
    );
    end();

    expect(open).not.toHaveBeenCalled();
  });
});
