import type { DesktopFetchPlatform } from "./createDesktopFetch";

/** An in-memory desktop for tests of the Desktop fetch module and its callers. */
export function createFakeDesktopFetchPlatform() {
  // Videos the desktop serves a file for.
  const files = new Set<string>();
  // Videos the desktop's records call completed though the file is gone (a 202).
  const lostFiles = new Set<string>();
  const failures = new Map<string, string>();
  const refusals = new Map<string, Error>();
  const progress = new Map<string, number>();
  const requests: string[] = [];
  const statusRequests: string[] = [];

  const platform: DesktopFetchPlatform = {
    requestVideo: async (_serverUrl, videoId) => {
      requests.push(videoId);
      const refusal = refusals.get(videoId);
      if (refusal) throw refusal;
      return files.has(videoId) || lostFiles.has(videoId)
        ? "ready"
        : "fetching";
    },
    getFetchStatus: async (_serverUrl, videoId) => {
      statusRequests.push(videoId);
      const error = failures.get(videoId);
      if (error) return { state: "failed", error };
      if (files.has(videoId) || lostFiles.has(videoId))
        return { state: "ready" };
      return { state: "fetching", progress: progress.get(videoId) ?? 40 };
    },
    probeFile: async (_serverUrl, videoId) => files.has(videoId),
  };

  return {
    platform,
    requests,
    statusRequests,
    has: (...ids: string[]) =>
      ids.forEach((id) => {
        lostFiles.delete(id);
        files.add(id);
      }),
    forgets: (id: string) => {
      files.delete(id);
      lostFiles.delete(id);
    },
    loses: (id: string) => {
      files.delete(id);
      lostFiles.add(id);
    },
    fails: (id: string, error: string) => failures.set(id, error),
    refuses: (id: string, error: Error) => refusals.set(id, error),
    reports: (id: string, percent: number) => progress.set(id, percent),
  };
}
