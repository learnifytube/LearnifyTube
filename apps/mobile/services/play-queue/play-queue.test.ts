import type { CurrentVideo } from "../../../shared/mobile-sync-contract";
import type { StreamingVideo } from "../../stores/playback";
import { createPlayQueue, type PlayQueueStart } from "./createPlayQueue";

const video = (id: string): StreamingVideo => ({
  id,
  title: `Video ${id}`,
  channelTitle: "Channel",
  duration: 60,
});

const videos = [video("a"), video("b"), video("c")];

function createHarness({
  surface = "phone" as "phone" | "tv",
  currentVideos = [] as CurrentVideo[],
  watched = [] as string[],
} = {}) {
  const queues: PlayQueueStart[] = [];
  const history: PlayQueueStart[] = [];
  // Current Videos kept on the Device, in the order they were kept.
  const kept: CurrentVideo[] = [];
  const clock = { now: 1000 };
  const playQueue = createPlayQueue({
    setQueue: (queue) => queues.push(queue),
    recordHistory: surface === "tv" ? (entry) => history.push(entry) : null,
    currentVideos: {
      get: ({ kind, id }) =>
        [...currentVideos, ...kept]
          .filter((c) => c.collectionKind === kind && c.collectionId === id)
          .at(-1) ?? null,
      keep: (currentVideo) => kept.push(currentVideo),
    },
    isWatched: (video) => watched.includes(video.id),
    now: () => clock.now,
  });
  return { playQueue, queues, history, kept, clock };
}

const course = { kind: "list" as const, id: "course" };
const currentVideo = (videoId: string, updatedAt = 1): CurrentVideo => ({
  collectionKind: "list",
  collectionId: "course",
  videoId,
  updatedAt,
});

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

  describe("started from a List", () => {
    it("resumes at the List's Current Video", () => {
      const { playQueue, queues } = createHarness({
        currentVideos: [currentVideo("b")],
      });

      const first = playQueue.resume({
        id: "mylist-course",
        title: "Course",
        videos,
        collection: course,
      });

      expect(first?.id).toBe("b");
      expect(queues[0].startIndex).toBe(1);
    });

    it("resumes at the next unwatched Video once the Current Video is watched", () => {
      const { playQueue } = createHarness({
        currentVideos: [currentVideo("a")],
        watched: ["a", "b"],
      });

      expect(playQueue.whereResumes({ videos, collection: course })?.id).toBe(
        "c",
      );
    });

    it("moves on past a Current Video this Device can't play now, and queues only what it can", () => {
      const { playQueue, queues } = createHarness({
        currentVideos: [currentVideo("b")],
      });

      const first = playQueue.resume({
        id: "mylist-course",
        title: "Course",
        videos: [video("a"), { ...video("b"), unavailable: true }, video("c")],
        collection: course,
      });

      expect(first?.id).toBe("c");
      expect(queues[0].videos.map((v) => v.id)).toEqual(["a", "c"]);
      expect(queues[0].startIndex).toBe(1);
    });

    it("resumes at the first Video when no Current Video is set", () => {
      const { playQueue } = createHarness();

      expect(playQueue.whereResumes({ videos, collection: course })?.id).toBe(
        "a",
      );
    });

    it("records the Video it starts as the List's Current Video", () => {
      const { playQueue, kept } = createHarness({
        currentVideos: [currentVideo("b")],
      });

      playQueue.start({
        id: "mylist-course",
        title: "Course",
        videos,
        startIndex: 0,
        collection: course,
      });

      expect(kept).toEqual([currentVideo("a", 1000)]);
    });

    it("records each Video that starts in it afterwards", () => {
      const { playQueue, kept, clock } = createHarness();
      playQueue.start({
        id: "mylist-course",
        title: "Course",
        videos,
        collection: course,
      });

      clock.now = 2000;
      playQueue.videoStarted("b");
      // The same Video starting again (the player opening it) records nothing new.
      clock.now = 3000;
      playQueue.videoStarted("b");

      expect(kept).toEqual([currentVideo("a", 1000), currentVideo("b", 2000)]);
    });

    it("records nothing for a Video that isn't in the queue", () => {
      const { playQueue, kept } = createHarness();
      playQueue.start({
        id: "mylist-course",
        title: "Course",
        videos,
        collection: course,
      });

      playQueue.videoStarted("elsewhere");

      expect(kept).toEqual([currentVideo("a", 1000)]);
    });
  });

  it("records no Current Video for a queue started anywhere else", () => {
    const { playQueue, kept } = createHarness();

    playQueue.start({ id: "channel-1", title: "Channel", videos });
    playQueue.videoStarted("b");

    expect(kept).toEqual([]);
  });

  it("stops recording for a List once another queue starts", () => {
    const { playQueue, kept } = createHarness();
    playQueue.start({
      id: "mylist-course",
      title: "Course",
      videos,
      collection: course,
    });

    playQueue.start({ id: "home", title: "Home", videos });
    playQueue.videoStarted("c");

    expect(kept).toEqual([currentVideo("a", 1000)]);
  });
});
