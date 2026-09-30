import {
  createDesktopFetch,
  DesktopFetchFailedError,
  DesktopStillFetchingError,
} from "./createDesktopFetch";
import { createFakeDesktopFetchPlatform } from "./fakeDesktopFetchPlatform";

const SERVER = "http://desktop.local:8384";

function createHarness() {
  const desktop = createFakeDesktopFetchPlatform();
  return { desktop, desktopFetch: createDesktopFetch(desktop.platform) };
}

// Settles a wait's outcome without letting an early rejection go unhandled.
function track(promise: Promise<void>) {
  const outcome: { done: boolean; error: unknown } = {
    done: false,
    error: null,
  };
  promise.then(
    () => {
      outcome.done = true;
    },
    (error) => {
      outcome.error = error;
    },
  );
  return outcome;
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Desktop fetch", () => {
  it("answers straight away when the desktop already serves the Video", async () => {
    const h = createHarness();
    h.desktop.has("v1");

    await h.desktopFetch.waitUntilFetched(SERVER, "v1");

    expect(h.desktop.requests).toEqual([]);
  });

  it("asks the desktop to fetch the Video and waits, reporting its progress", async () => {
    const h = createHarness();
    const progress: (number | null)[] = [];
    const wait = track(
      h.desktopFetch.waitUntilFetched(SERVER, "v1", {
        onProgress: (p) => progress.push(p),
      }),
    );
    await flush();
    expect(h.desktop.requests).toEqual(["v1"]);

    h.desktop.reports("v1", 55);
    await jest.advanceTimersByTimeAsync(2000);
    expect(wait.done).toBe(false);
    expect(progress).toEqual([null, 55]);

    h.desktop.has("v1");
    await jest.advanceTimersByTimeAsync(2000);
    expect(wait.done).toBe(true);
  });

  it("keeps waiting while the desktop calls the Video fetched but has lost its file", async () => {
    const h = createHarness();
    h.desktop.loses("v1");
    const wait = track(h.desktopFetch.waitUntilFetched(SERVER, "v1"));

    await jest.advanceTimersByTimeAsync(6000);
    expect(wait.done).toBe(false);
    expect(wait.error).toBeNull();

    h.desktop.has("v1");
    await jest.advanceTimersByTimeAsync(2000);
    expect(wait.done).toBe(true);
  });

  it("fails with the desktop's error when it can't fetch the Video", async () => {
    const h = createHarness();
    const wait = track(h.desktopFetch.waitUntilFetched(SERVER, "v1"));
    await flush();

    h.desktop.fails("v1", "Sign in to confirm you're not a bot");
    await jest.advanceTimersByTimeAsync(2000);

    expect(wait.error).toBeInstanceOf(DesktopFetchFailedError);
    expect((wait.error as DesktopFetchFailedError).desktopError).toBe(
      "Sign in to confirm you're not a bot",
    );
  });

  it("fails when the desktop can't be asked for the Video", async () => {
    const h = createHarness();
    h.desktop.refuses("v1", new Error("HTTP 500"));

    await expect(h.desktopFetch.waitUntilFetched(SERVER, "v1")).rejects.toThrow(
      "HTTP 500",
    );
    expect(h.desktop.statusRequests).toEqual([]);
  });

  it("stops waiting after 10 minutes", async () => {
    const h = createHarness();
    const wait = track(h.desktopFetch.waitUntilFetched(SERVER, "v1"));

    await jest.advanceTimersByTimeAsync(9 * 60_000);
    expect(wait.error).toBeNull();

    await jest.advanceTimersByTimeAsync(60_000);
    expect(wait.error).toBeInstanceOf(DesktopStillFetchingError);
  });

  it("stops asking the desktop once the wait is aborted", async () => {
    const h = createHarness();
    const controller = new AbortController();
    const wait = track(
      h.desktopFetch.waitUntilFetched(SERVER, "v1", {
        signal: controller.signal,
      }),
    );
    await jest.advanceTimersByTimeAsync(2000);
    const polls = h.desktop.statusRequests.length;

    controller.abort();
    await jest.advanceTimersByTimeAsync(20_000);

    expect((wait.error as Error).name).toBe("AbortError");
    expect(h.desktop.statusRequests).toHaveLength(polls);
  });
});
