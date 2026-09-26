import { act, renderHook } from "@testing-library/react-native";
import { createOfflineCopy } from "../offline-copy/createOfflineCopy";
import { createFakeOfflineCopyPlatform } from "../offline-copy/fakeOfflineCopyPlatform";
import type { Video } from "../../types";
import {
  createDownloadQueue,
  type DownloadQueuePlatform,
  type StoredDownload,
} from "./createDownloadQueue";

const SERVER = "http://desktop.local:8384";

type Transfer = {
  videoId: string;
  destUri: string;
  progress: (percent: number) => void;
  finish: () => Promise<void>;
  fail: (message: string) => void;
  missing: () => void;
  aborted: boolean;
  settled: boolean;
};

function summary(id: string) {
  return {
    id,
    title: `Video ${id}`,
    channelTitle: "Channel",
    duration: 60,
    thumbnailUrl: `https://img/${id}.jpg`,
  };
}

function createHarness({ saved = [] as StoredDownload[] } = {}) {
  const device = createFakeOfflineCopyPlatform();
  const offlineCopy = createOfflineCopy(device.platform);
  const listeners = new Set<() => void>();
  const conditions = {
    serverUrl: SERVER as string | null,
    foreground: true,
  };
  const desktopFiles = new Set<string>();
  const desktopFailures = new Map<string, string>();
  const statusRequests: string[] = [];
  const transfers: Transfer[] = [];
  const library = new Map<string, Video>();
  let persisted: StoredDownload[] = saved;

  const platform: DownloadQueuePlatform = {
    offlineCopy,
    getServerUrl: () => conditions.serverUrl,
    isForeground: () => conditions.foreground,
    onConditionsChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    desktop: {
      requestVideo: async (_serverUrl, videoId) =>
        desktopFiles.has(videoId) ? "ready" : "fetching",
      getFetchStatus: async (_serverUrl, videoId) => {
        statusRequests.push(videoId);
        const error = desktopFailures.get(videoId);
        if (error) return { state: "failed", error };
        if (desktopFiles.has(videoId)) return { state: "ready" };
        return { state: "fetching", progress: 40 };
      },
      transfer: (_serverUrl, videoId, destUri, onProgress, signal) =>
        new Promise((resolve, reject) => {
          const transfer: Transfer = {
            videoId,
            destUri,
            aborted: false,
            settled: false,
            progress: onProgress,
            finish: async () => {
              transfer.settled = true;
              device.write(destUri);
              resolve("done");
              await flush();
            },
            fail: (message) => {
              transfer.settled = true;
              reject(new Error(message));
            },
            missing: () => {
              transfer.settled = true;
              desktopFiles.delete(videoId);
              resolve("missing");
            },
          };
          signal.addEventListener("abort", () => {
            transfer.aborted = true;
            reject(new Error("aborted"));
          });
          transfers.push(transfer);
        }),
      getDetails: async (_serverUrl, videoId) => ({
        description: `About ${videoId}`,
        transcripts: [{ language: "en", segments: [] }],
      }),
    },
    addToLibrary: (video) => {
      library.set(video.id, video);
    },
    loadQueue: async () => persisted,
    saveQueue: (downloads) => {
      persisted = downloads;
    },
  };

  const queue = createDownloadQueue(platform);

  return {
    queue,
    platform,
    offlineCopy,
    device,
    library,
    transfers,
    statusRequests,
    persisted: () => persisted,
    desktopHas: (...ids: string[]) => ids.forEach((id) => desktopFiles.add(id)),
    desktopFails: (id: string, error: string) => desktopFailures.set(id, error),
    activeTransfers: () => transfers.filter((t) => !t.aborted && !t.settled),
    setConditions: (next: Partial<typeof conditions>) => {
      Object.assign(conditions, next);
      for (const listener of listeners) listener();
    },
  };
}

async function flush() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

async function started(harness: ReturnType<typeof createHarness>) {
  harness.queue.start();
  await flush();
  return harness;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Download queue", () => {
  it("turns a requested Video the desktop has into an Offline copy in the library", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1");

    h.queue.request(summary("v1"));
    await flush();
    await h.transfers[0].finish();

    expect(h.offlineCopy.getUri("v1")).toBe(
      "file:///container-a/Documents/videos/v1.mp4",
    );
    expect(h.library.get("v1")).toMatchObject({
      id: "v1",
      title: "Video v1",
      thumbnailUrl: "https://img/v1.jpg",
      description: "About v1",
      transcripts: [{ language: "en", segments: [] }],
    });
    expect(h.queue.getDownload("v1")).toBeNull();
  });

  it("waits for the desktop to fetch a Video it doesn't have, then transfers it", async () => {
    const h = await started(createHarness());

    h.queue.request(summary("v1"));
    await flush();
    await jest.advanceTimersByTimeAsync(2000);

    expect(h.queue.getDownload("v1")).toMatchObject({
      phase: "waiting-for-desktop",
      progress: 40,
    });
    expect(h.transfers).toHaveLength(0);

    h.desktopHas("v1");
    await jest.advanceTimersByTimeAsync(2000);

    expect(h.queue.getDownload("v1")?.phase).toBe("transferring");
    await h.transfers[0].finish();
    expect(h.offlineCopy.getUri("v1")).not.toBeNull();
  });

  it("fails without retrying when the desktop can't fetch the Video", async () => {
    const h = await started(createHarness());

    h.queue.request(summary("v1"));
    await flush();
    h.desktopFails("v1", "Video unavailable");
    await jest.advanceTimersByTimeAsync(2000);

    expect(h.queue.getDownload("v1")).toMatchObject({
      phase: "failed",
      error: "Video unavailable",
    });
    const polls = h.statusRequests.length;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(h.statusRequests).toHaveLength(polls);
  });

  it("fails when the desktop takes more than 10 minutes to fetch the Video", async () => {
    const h = await started(createHarness());

    h.queue.request(summary("v1"));
    await flush();
    await jest.advanceTimersByTimeAsync(9 * 60_000);
    expect(h.queue.getDownload("v1")?.phase).toBe("waiting-for-desktop");

    await jest.advanceTimersByTimeAsync(60_000);
    expect(h.queue.getDownload("v1")).toMatchObject({
      phase: "failed",
      error: "The desktop took too long to fetch this Video",
    });
  });

  it("transfers two Videos at a time, oldest request first", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1", "v2", "v3");

    for (const id of ["v1", "v2", "v3"]) {
      h.queue.request(summary(id));
      await jest.advanceTimersByTimeAsync(10);
    }

    expect(h.activeTransfers().map((t) => t.videoId)).toEqual(["v1", "v2"]);
    expect(h.queue.getDownload("v3")?.phase).toBe("queued");

    await h.transfers[0].finish();
    expect(h.activeTransfers().map((t) => t.videoId)).toEqual(["v2", "v3"]);
  });

  it("retries a failed transfer after 1s, 3s and 10s, then fails until asked again", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1");
    h.queue.request(summary("v1"));
    await flush();

    for (const delay of [1000, 3000, 10_000]) {
      h.activeTransfers()[0].fail("Network lost");
      await flush();
      expect(h.queue.getDownload("v1")?.phase).toBe("queued");

      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(h.activeTransfers()).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(1);
      expect(h.activeTransfers()).toHaveLength(1);
    }

    h.activeTransfers()[0].fail("Network lost");
    await flush();
    expect(h.queue.getDownload("v1")).toMatchObject({
      phase: "failed",
      error: "Network lost",
    });
    expect(h.device.files.size).toBe(0);

    h.queue.request(summary("v1"));
    await flush();
    expect(h.activeTransfers()).toHaveLength(1);
  });

  it("waits for the desktop again when it has lost the Video's file", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1");
    h.queue.request(summary("v1"));
    await flush();

    h.activeTransfers()[0].missing();
    await flush();
    expect(h.queue.getDownload("v1")?.phase).toBe("waiting-for-desktop");
    expect(h.device.files.size).toBe(0);

    h.desktopHas("v1");
    await jest.advanceTimersByTimeAsync(2000);
    await h.activeTransfers()[0].finish();
    expect(h.offlineCopy.getUri("v1")).not.toBeNull();
  });

  it("fails when the desktop can't be asked for the Video", async () => {
    const h = createHarness();
    h.queue.start();
    const requestVideo = jest.fn().mockRejectedValue(new Error("HTTP 500"));
    Object.assign(h.platform.desktop, { requestVideo });

    h.queue.request(summary("v1"));
    await flush();

    expect(h.queue.getDownload("v1")).toMatchObject({
      phase: "failed",
      error: "HTTP 500",
    });
    expect(requestVideo).toHaveBeenCalledTimes(1);
  });

  it("holds Downloads while the desktop is disconnected or the app is in the background", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1");
    h.setConditions({ serverUrl: null });

    h.queue.request(summary("v1"));
    await jest.advanceTimersByTimeAsync(5000);
    expect(h.queue.getDownload("v1")?.phase).toBe("waiting-for-desktop");
    expect(h.transfers).toHaveLength(0);

    h.setConditions({ foreground: false });
    h.setConditions({ serverUrl: SERVER });
    await flush();
    expect(h.transfers).toHaveLength(0);

    h.setConditions({ foreground: true });
    await flush();
    expect(h.activeTransfers()).toHaveLength(1);
  });

  it("cancels a transfer, leaving no partial file, and starts the next Download", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1", "v2", "v3");
    for (const id of ["v1", "v2", "v3"]) {
      h.queue.request(summary(id));
      await jest.advanceTimersByTimeAsync(10);
    }
    h.device.write(h.transfers[0].destUri);

    h.queue.cancel("v1");
    await flush();

    expect(h.transfers[0].aborted).toBe(true);
    expect(h.queue.getDownload("v1")).toBeNull();
    expect(h.device.files.has(h.transfers[0].destUri)).toBe(false);
    expect(h.library.has("v1")).toBe(false);
    expect(h.activeTransfers().map((t) => t.videoId)).toEqual(["v2", "v3"]);
  });

  it("stops asking the desktop about a Download cancelled while waiting", async () => {
    const h = await started(createHarness());
    h.queue.request(summary("v1"));
    await jest.advanceTimersByTimeAsync(2000);
    const polls = h.statusRequests.length;

    h.queue.cancel("v1");
    await jest.advanceTimersByTimeAsync(20_000);

    expect(h.queue.getDownload("v1")).toBeNull();
    expect(h.statusRequests).toHaveLength(polls);
  });

  it("restores saved Downloads, restarting unfinished transfers and dropping completed ones", async () => {
    const saved = (id: string, status: string, extra = {}) => ({
      videoId: id,
      title: `Video ${id}`,
      channelTitle: "Channel",
      duration: 60,
      addedAt: 1,
      status,
      ...extra,
    });
    const h = createHarness({
      saved: [
        saved("done", "completed"),
        saved("mid", "downloading"),
        saved("old", "paused"),
        saved("bad", "failed", { error: "Network lost" }),
        saved("wait", "waiting-for-desktop"),
      ],
    });
    h.setConditions({ serverUrl: null });
    await started(h);

    expect(h.queue.getDownload("done")).toBeNull();
    expect(h.queue.getDownload("mid")?.phase).toBe("queued");
    expect(h.queue.getDownload("old")?.phase).toBe("queued");
    expect(h.queue.getDownload("bad")).toMatchObject({
      phase: "failed",
      error: "Network lost",
    });
    expect(h.queue.getDownload("wait")?.phase).toBe("waiting-for-desktop");
  });

  it("saves the Download queue as it changes", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1");

    h.queue.request(summary("v1"));
    await flush();
    expect(h.persisted()).toEqual([
      expect.objectContaining({ videoId: "v1", status: "transferring" }),
    ]);

    await h.activeTransfers()[0].finish();
    expect(h.persisted()).toEqual([]);
  });

  it("resolves a wait with the Offline copy once the Download finishes", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1");
    h.queue.request(summary("v1"));
    const ready = h.queue.waitUntilReady("v1");
    await flush();

    await h.activeTransfers()[0].finish();

    await expect(ready).resolves.toBe(
      "file:///container-a/Documents/videos/v1.mp4",
    );
  });

  it("rejects a wait when the Download fails or is cancelled", async () => {
    const h = await started(createHarness());
    h.queue.request(summary("v1"));
    h.queue.request(summary("v2"));
    const failed = expect(h.queue.waitUntilReady("v1")).rejects.toThrow(
      "Video unavailable",
    );
    const cancelled = expect(h.queue.waitUntilReady("v2")).rejects.toThrow(
      "Download cancelled",
    );
    await flush();

    h.desktopFails("v1", "Video unavailable");
    await jest.advanceTimersByTimeAsync(2000);
    h.queue.cancel("v2");

    await failed;
    await cancelled;
  });

  it("keeps downloading after the caller stops waiting", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1");
    h.queue.request(summary("v1"));
    const controller = new AbortController();
    const ready = h.queue.waitUntilReady("v1", controller.signal);
    await flush();

    controller.abort();
    await expect(ready).rejects.toThrow("aborted");

    await h.activeTransfers()[0].finish();
    expect(h.offlineCopy.getUri("v1")).not.toBeNull();
  });

  it("re-renders a Video's Download and the whole queue as they change", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1");
    const one = await renderHook(() => h.queue.useDownload("v1"));
    const all = await renderHook(() => h.queue.useQueue());
    expect(one.result.current).toBeNull();

    await act(async () => {
      h.queue.request(summary("v1"));
      await flush();
    });
    expect(one.result.current?.phase).toBe("transferring");
    expect(all.result.current.map((d) => d.videoId)).toEqual(["v1"]);

    await act(async () => {
      await h.activeTransfers()[0].finish();
    });
    expect(one.result.current).toBeNull();
    expect(all.result.current).toEqual([]);
  });

  it("ignores a request for a Video already on its way or already offline", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1", "v2");
    const tempUri = await h.offlineCopy.tempFileUri("v2");
    h.device.write(tempUri);
    await h.offlineCopy.adopt("v2", tempUri);

    h.queue.request(summary("v1"));
    h.queue.request(summary("v1"));
    h.queue.request(summary("v2"));
    await flush();

    expect(h.transfers.map((t) => t.videoId)).toEqual(["v1"]);
    expect(h.queue.getDownload("v2")).toBeNull();
  });

  it("reports transfer progress at most every 250ms", async () => {
    const h = await started(createHarness());
    h.desktopHas("v1");
    h.queue.request(summary("v1"));
    await flush();
    const transfer = h.activeTransfers()[0];

    transfer.progress(10);
    expect(h.queue.getDownload("v1")?.progress).toBe(10);
    await jest.advanceTimersByTimeAsync(100);
    transfer.progress(20);
    expect(h.queue.getDownload("v1")?.progress).toBe(10);
    await jest.advanceTimersByTimeAsync(150);
    transfer.progress(30);
    expect(h.queue.getDownload("v1")?.progress).toBe(30);
  });
});
