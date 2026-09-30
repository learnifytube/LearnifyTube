import type { StreamingVideo } from "../../stores/playback";
import { createPlayQueue, type PlayQueueStart } from "./createPlayQueue";

const video = (id: string): StreamingVideo => ({
  id,
  title: `Video ${id}`,
  channelTitle: "Channel",
  duration: 60,
});

const videos = [video("a"), video("b"), video("c")];

function createHarness({ surface = "phone" as "phone" | "tv" } = {}) {
  const queues: PlayQueueStart[] = [];
  const history: PlayQueueStart[] = [];
  const playQueue = createPlayQueue({
    setQueue: (queue) => queues.push(queue),
    recordHistory: surface === "tv" ? (entry) => history.push(entry) : null,
  });
  return { playQueue, queues, history };
}

describe("Play queue", () => {
  it("starts the queue at the chosen Video and returns it to open", () => {
    const { playQueue, queues } = createHarness();

    const first = playQueue.start({
      id: "channel-1",
      title: "Channel",
      videos,
      startIndex: 1,
    });

    expect(first?.id).toBe("b");
    expect(queues).toEqual([
      { id: "channel-1", title: "Channel", videos, startIndex: 1 },
    ]);
  });

  it("starts at the first Video when no index is given", () => {
    const { playQueue, queues } = createHarness();

    expect(playQueue.start({ id: "q", title: "Q", videos })?.id).toBe("a");
    expect(queues[0].startIndex).toBe(0);
  });

  it("clamps an index outside the queue", () => {
    const { playQueue } = createHarness();

    expect(
      playQueue.start({ id: "q", title: "Q", videos, startIndex: 9 })?.id,
    ).toBe("c");
    expect(
      playQueue.start({ id: "q", title: "Q", videos, startIndex: -2 })?.id,
    ).toBe("a");
  });

  it("starts nothing for an empty queue", () => {
    const { playQueue, queues, history } = createHarness({ surface: "tv" });

    expect(playQueue.start({ id: "q", title: "Q", videos: [] })).toBeNull();
    expect(queues).toEqual([]);
    expect(history).toEqual([]);
  });

  it("records the queue in TV history on the TV", () => {
    const { playQueue, history } = createHarness({ surface: "tv" });

    playQueue.start({ id: "q", title: "Q", videos, startIndex: 2 });

    expect(history).toEqual([{ id: "q", title: "Q", videos, startIndex: 2 }]);
  });

  it("keeps no TV history on the phone", () => {
    const { playQueue, history } = createHarness();

    playQueue.start({ id: "q", title: "Q", videos });

    expect(history).toEqual([]);
  });
});
