import { DesktopFetchFailedError } from "../desktop-fetch/createDesktopFetch";
import { createDesktopFetch } from "../desktop-fetch/createDesktopFetch";
import { createFakeDesktopFetchPlatform } from "../desktop-fetch/fakeDesktopFetchPlatform";
import type { ConnectionStatus } from "../desktop-connection/createDesktopConnection";
import {
  createPlaybackSource,
  type PlaybackSourceRequest,
} from "./createPlaybackSource";

const SERVER = "http://desktop.local:8384";

function createHarness({ connected = true } = {}) {
  const desktop = createFakeDesktopFetchPlatform();
  const connection = {
    status: (connected ? "connected" : "offline") as ConnectionStatus,
    url: connected ? SERVER : (null as string | null),
  };
  const desktopListeners = new Set<() => void>();
  const offlineCopies = new Map<string, string>();
  const offlineCopyListeners = new Set<() => void>();
  const player = { position: 0 };

  const playbackSource = createPlaybackSource({
    getDesktop: () => connection,
    onDesktopChange: (listener) => {
      desktopListeners.add(listener);
      return () => desktopListeners.delete(listener);
    },
    offlineCopy: {
      getUri: (videoId) => offlineCopies.get(videoId) ?? null,
      subscribe: (listener) => {
        offlineCopyListeners.add(listener);
        return () => offlineCopyListeners.delete(listener);
      },
    },
    desktopFetch: createDesktopFetch(desktop.platform),
    streamUrl: (serverUrl, videoId) => `${serverUrl}/api/video/${videoId}/file`,
    log: () => {},
  });

  const setConnection = (next: typeof connection) => {
    Object.assign(connection, next);
    for (const listener of [...desktopListeners]) listener();
  };

  return {
    desktop,
    player,
    holds: (...ids: string[]) => {
      for (const id of ids) offlineCopies.set(id, `file:///videos/${id}.mp4`);
      for (const listener of [...offlineCopyListeners]) listener();
    },
    disconnect: () => setConnection({ status: "offline", url: null }),
    connect: () => setConnection({ status: "connected", url: SERVER }),
    /** Opens a session and subscribes to it, as the player screen does. */
    play: (request: Partial<PlaybackSourceRequest> & { videoId: string }) => {
      const session = playbackSource.open({
        queue: [],
        index: -1,
        getPosition: () => player.position,
        ...request,
      });
      const stop = session.subscribe(() => {});
      return { session, stop, state: session.getState };
    },
  };
}

const queueOf = (...ids: string[]) => ids.map((id) => ({ id }));

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Playback source", () => {
  it("plays a held Video from its Offline copy without asking the desktop", async () => {
    const h = createHarness();
    h.holds("v1");

    const { state } = h.play({ videoId: "v1" });
    await flush();

    expect(state().source).toEqual({
      kind: "offline",
      uri: "file:///videos/v1.mp4",
      resumeAt: null,
    });
    expect(h.desktop.requests).toEqual([]);
  });

  it("says the Video isn't found when the player has no Video", () => {
    const h = createHarness();

    const { state } = h.play({ videoId: "" });

    expect(state().source).toMatchObject({
      kind: "failed",
      failure: { kind: "videoNotFound" },
    });
    expect(h.desktop.requests).toEqual([]);
  });

  it("says the Video isn't on this TV in Offline mode when it isn't held", () => {
    const h = createHarness({ connected: false });

    const { state } = h.play({ videoId: "v1" });

    expect(state().source).toMatchObject({
      kind: "failed",
      failure: { kind: "notOnThisTV" },
      canRetry: false,
    });
  });

  it("streams a Video once the desktop has fetched it, reporting its progress meanwhile", async () => {
    const h = createHarness();
    const { state } = h.play({ videoId: "v1" });
    await flush();
    expect(state().source).toEqual({ kind: "preparing", progress: null });

    h.desktop.reports("v1", 30);
    await jest.advanceTimersByTimeAsync(2000);
    expect(state().source).toEqual({ kind: "preparing", progress: 30 });

    h.desktop.has("v1");
    await jest.advanceTimersByTimeAsync(2000);
    expect(state().source).toEqual({
      kind: "stream",
      uri: `${SERVER}/api/video/v1/file`,
    });
  });

  it("switches to the Offline copy when it lands while the desktop is still fetching", async () => {
    const h = createHarness();
    const { state } = h.play({ videoId: "v1" });
    await flush();

    h.holds("v1");

    expect(state().source).toMatchObject({ kind: "offline" });
    const polls = h.desktop.statusRequests.length;
    await jest.advanceTimersByTimeAsync(10_000);
    expect(h.desktop.statusRequests).toHaveLength(polls);
  });

  it("keeps a Stream that has started when the Offline copy lands", async () => {
    const h = createHarness();
    h.desktop.has("v1");
    const { state } = h.play({ videoId: "v1" });
    await flush();

    h.holds("v1");

    expect(state().source).toMatchObject({ kind: "stream" });
  });

  it("fails with the desktop's error, and prepares again on retry", async () => {
    const h = createHarness();
    const { session, state } = h.play({ videoId: "v1" });
    await flush();

    h.desktop.fails("v1", "Video unavailable");
    await jest.advanceTimersByTimeAsync(2000);
    const { source } = state();
    expect(source).toMatchObject({ kind: "failed", canRetry: true });
    expect(
      source.kind === "failed" &&
        source.failure.kind === "desktopFailed" &&
        source.failure.error,
    ).toBeInstanceOf(DesktopFetchFailedError);

    h.desktop.has("v1");
    session.retry();
    await flush();
    expect(state().source).toMatchObject({ kind: "stream" });
  });

  it("offers no retry for a desktop failure once the desktop is gone", async () => {
    const h = createHarness();
    const { state } = h.play({ videoId: "v1" });
    await flush();
    h.desktop.fails("v1", "Video unavailable");
    await jest.advanceTimersByTimeAsync(2000);

    h.disconnect();

    expect(state().source).toMatchObject({ kind: "failed", canRetry: false });
  });

  it("starts preparing when the desktop connects after the Video wasn't on this TV", async () => {
    const h = createHarness({ connected: false });
    const { state } = h.play({ videoId: "v1" });

    h.desktop.has("v1");
    h.connect();
    await flush();

    expect(state().source).toMatchObject({ kind: "stream" });
  });

  describe("when the desktop drops out mid-Stream", () => {
    it("carries on from the Offline copy at the same position", async () => {
      const h = createHarness();
      h.desktop.has("v1");
      const { state } = h.play({ videoId: "v1" });
      await flush();
      h.holds("v1");
      h.player.position = 95;

      h.disconnect();

      expect(state().source).toEqual({
        kind: "offline",
        uri: "file:///videos/v1.mp4",
        resumeAt: 95,
      });
    });

    it("moves on to the next Video in the queue the TV holds", async () => {
      const h = createHarness();
      h.desktop.has("v1");
      h.holds("v3");
      const { state } = h.play({
        videoId: "v1",
        queue: queueOf("v1", "v2", "v3"),
        index: 0,
      });
      await flush();

      h.disconnect();

      expect(state().source).toEqual({ kind: "desktopLost", nextIndex: 2 });
    });

    it("goes back when the TV holds nothing further in the queue", async () => {
      const h = createHarness();
      h.desktop.has("v1");
      h.holds("v0");
      const { state } = h.play({
        videoId: "v1",
        queue: queueOf("v0", "v1", "v2"),
        index: 1,
      });
      await flush();

      h.disconnect();

      expect(state().source).toEqual({ kind: "desktopLost", nextIndex: null });
    });

    it("also carries on when it drops out while the desktop is still fetching", async () => {
      const h = createHarness();
      h.holds("v2");
      const { state } = h.play({
        videoId: "v1",
        queue: queueOf("v1", "v2"),
        index: 0,
      });
      await flush();

      h.disconnect();

      expect(state().source).toEqual({ kind: "desktopLost", nextIndex: 1 });
    });
  });

  it("keeps playing an Offline copy while the desktop comes and goes", async () => {
    const h = createHarness({ connected: false });
    h.holds("v1");
    const { state } = h.play({ videoId: "v1" });

    h.connect();
    h.disconnect();
    await flush();

    expect(state().source).toMatchObject({ kind: "offline", resumeAt: null });
  });

  it("warms the next Video in the queue when the TV doesn't hold it", async () => {
    const h = createHarness();
    h.holds("v1");
    const { state } = h.play({
      videoId: "v1",
      queue: queueOf("v1", "v2"),
      index: 0,
    });
    await flush();
    expect(state().upNext).toBe("loading");
    expect(h.desktop.requests).toEqual(["v2"]);

    h.desktop.has("v2");
    await jest.advanceTimersByTimeAsync(2000);
    expect(state().upNext).toBe("ready");
  });

  it("doesn't warm a next Video the TV already holds", async () => {
    const h = createHarness();
    h.holds("v1", "v2");
    const { state } = h.play({
      videoId: "v1",
      queue: queueOf("v1", "v2"),
      index: 0,
    });
    await flush();

    expect(state().upNext).toBe("ready");
    expect(h.desktop.requests).toEqual([]);
  });

  it("stops preparing and warming once the player leaves the Video", async () => {
    const h = createHarness();
    const { stop } = h.play({
      videoId: "v1",
      queue: queueOf("v1", "v2"),
      index: 0,
    });
    await jest.advanceTimersByTimeAsync(2000);
    const polls = h.desktop.statusRequests.length;

    stop();
    await jest.advanceTimersByTimeAsync(20_000);

    expect(h.desktop.statusRequests).toHaveLength(polls);
  });
});
