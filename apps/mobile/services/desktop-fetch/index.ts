import { api } from "../api";
import {
  createDesktopFetch,
  DesktopFetchFailedError,
  type DesktopFetchPlatform,
} from "./createDesktopFetch";

// A 202 is the desktop saying it lost the file and is fetching it again.
const isServed = (response: Response) =>
  response.status === 200 || response.status === 206;

const platform: DesktopFetchPlatform = {
  requestVideo: async (serverUrl, videoId) => {
    const response = await api.requestServerDownload(serverUrl, { videoId });
    if (!response.success && !response.status) {
      throw new DesktopFetchFailedError(response.message || null);
    }
    return response.status === "completed" ? "ready" : "fetching";
  },
  getFetchStatus: async (serverUrl, videoId) => {
    const status = await api.getServerDownloadStatus(serverUrl, videoId);
    if (status.status === "completed") return { state: "ready" };
    if (status.status === "failed")
      return { state: "failed", error: status.error };
    return { state: "fetching", progress: status.progress };
  },
  probeFile: async (serverUrl, videoId, signal) => {
    const fileUrl = api.getVideoFileUrl(serverUrl, videoId);
    try {
      const head = await fetch(fileUrl, { method: "HEAD", signal });
      if (isServed(head)) return true;
    } catch {
      // Some servers refuse HEAD; try a small range instead.
    }
    try {
      const probe = await fetch(fileUrl, {
        signal,
        headers: { Range: "bytes=0-2048" },
      });
      if (!isServed(probe)) return false;
      await probe.arrayBuffer();
      return true;
    } catch {
      return false;
    }
  },
};

export const desktopFetch = createDesktopFetch(platform);
export {
  DesktopFetchFailedError,
  DesktopStillFetchingError,
  type DesktopFetch,
} from "./createDesktopFetch";
