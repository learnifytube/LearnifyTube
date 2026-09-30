export type DesktopFetchStatus =
  | { state: "ready" }
  | { state: "fetching"; progress?: number | null }
  | { state: "failed"; error?: string | null };

export type DesktopFetchPlatform = {
  /** Asks the desktop to have the Video's file; "ready" when it says it already does. */
  requestVideo: (
    serverUrl: string,
    videoId: string,
  ) => Promise<"ready" | "fetching">;
  getFetchStatus: (
    serverUrl: string,
    videoId: string,
  ) => Promise<DesktopFetchStatus>;
  /** Whether the desktop serves the Video's file now: a 200 or 206, not the 202 of a lost file. */
  probeFile: (
    serverUrl: string,
    videoId: string,
    signal?: AbortSignal,
  ) => Promise<boolean>;
};

/** The desktop tried to fetch the Video from YouTube and failed. */
export class DesktopFetchFailedError extends Error {
  constructor(readonly desktopError: string | null) {
    super(desktopError || "The desktop couldn't fetch this Video");
    this.name = "DesktopFetchFailedError";
  }
}

/** The desktop is still fetching the Video after the Device stopped waiting. */
export class DesktopStillFetchingError extends Error {
  constructor() {
    super("The desktop took too long to fetch this Video");
    this.name = "DesktopStillFetchingError";
  }
}

const POLL_MS = 2000;
const TIMEOUT_MS = 10 * 60_000;

function abortError() {
  const error = new Error("Desktop fetch wait aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort);
  });

export function createDesktopFetch(platform: DesktopFetchPlatform) {
  const waitUntilFetched = async (
    serverUrl: string,
    videoId: string,
    {
      signal,
      onProgress,
    }: {
      signal?: AbortSignal;
      onProgress?: (progress: number | null) => void;
    } = {},
  ) => {
    throwIfAborted(signal);
    if (await platform.probeFile(serverUrl, videoId, signal)) return;
    throwIfAborted(signal);

    let answer: DesktopFetchStatus =
      (await platform.requestVideo(serverUrl, videoId)) === "ready"
        ? { state: "ready" }
        : { state: "fetching" };
    const startedAt = Date.now();
    for (;;) {
      throwIfAborted(signal);
      if (answer.state === "failed") {
        throw new DesktopFetchFailedError(answer.error ?? null);
      }
      // The desktop's "completed" comes from its records; a file gone from its
      // disk answers 202 while it fetches the Video again, so keep waiting.
      if (
        answer.state === "ready" &&
        (await platform.probeFile(serverUrl, videoId, signal))
      ) {
        return;
      }
      if (answer.state === "fetching") onProgress?.(answer.progress ?? null);
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        throw new DesktopStillFetchingError();
      }
      await sleep(POLL_MS, signal);
      answer = await platform.getFetchStatus(serverUrl, videoId);
    }
  };

  return {
    /**
     * Resolves once the desktop serves the Video's file, asking it to fetch the
     * Video from YouTube first when it doesn't have it. Rejects with
     * DesktopFetchFailedError or, after 10 minutes, DesktopStillFetchingError;
     * aborting stops the wait, not the desktop's fetch.
     */
    waitUntilFetched,
  };
}

export type DesktopFetch = ReturnType<typeof createDesktopFetch>;
