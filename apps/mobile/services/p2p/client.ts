import * as FileSystemLegacy from "expo-file-system/legacy";
import { offlineCopy } from "../offline-copy";
import type { DiscoveredPeer, PeerVideo, VideoMeta } from "../../types";

const TIMEOUT = 10000;

const log = (message: string, data?: unknown) => {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  if (data) {
    console.log(`[${timestamp}] [P2P Client] ${message}`, data);
  } else {
    console.log(`[${timestamp}] [P2P Client] ${message}`);
  }
};

function getPeerUrl(peer: DiscoveredPeer): string {
  const url = `http://${peer.host}:${peer.port}`;
  log(`Peer URL: ${url}`);
  return url;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

export async function getPeerInfo(
  peer: DiscoveredPeer
): Promise<{ name: string; videoCount: number }> {
  log(`Getting peer info from ${peer.name}`);
  const url = getPeerUrl(peer);
  const response = await fetchWithTimeout(`${url}/info`);

  if (!response.ok) {
    log(`Failed to get peer info: HTTP ${response.status}`);
    throw new Error(`HTTP ${response.status}`);
  }

  const info = await response.json();
  log(`Peer info received:`, info);
  return info;
}

export async function getPeerVideos(peer: DiscoveredPeer): Promise<PeerVideo[]> {
  log(`Getting videos from ${peer.name}`);
  const url = getPeerUrl(peer);
  const response = await fetchWithTimeout(`${url}/videos`);

  if (!response.ok) {
    log(`Failed to get videos: HTTP ${response.status}`);
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  log(`Received ${data.videos.length} videos from peer`);
  return data.videos;
}

export async function getVideoMeta(
  peer: DiscoveredPeer,
  videoId: string
): Promise<VideoMeta> {
  const url = getPeerUrl(peer);
  const response = await fetchWithTimeout(`${url}/video/${videoId}/meta`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Download a Video from a peer to a temporary file. The caller hands the file
 * to `offlineCopy.adopt`; on failure the partial file is discarded.
 */
export async function downloadVideoFromPeer(
  peer: DiscoveredPeer,
  videoId: string,
  onProgress: (progress: number) => void
): Promise<{ tempUri: string; meta: VideoMeta }> {
  const tempUri = await offlineCopy.tempFileUri(videoId);
  const url = getPeerUrl(peer);
  const videoUrl = `${url}/video/${videoId}/file`;

  log(`Starting download from peer: ${videoUrl}`);

  // Signal that download is starting
  onProgress(0);

  try {
    // Use legacy FileSystem API for downloading with progress
    const downloadResumable = FileSystemLegacy.createDownloadResumable(
      videoUrl,
      tempUri,
      {},
      (downloadProgress) => {
        const progress = Math.round(
          (downloadProgress.totalBytesWritten /
            downloadProgress.totalBytesExpectedToWrite) *
            100
        );
        onProgress(progress);
      }
    );

    const result = await downloadResumable.downloadAsync();

    if (!result || result.status !== 200) {
      throw new Error(`Download failed: ${result?.status || "unknown error"}`);
    }

    log(`Download complete: ${result.uri}`);
    onProgress(100);

    // Fetch video metadata including transcript
    const meta = await getVideoMeta(peer, videoId);

    return {
      tempUri,
      meta,
    };
  } catch (error) {
    await offlineCopy.discardTemp(videoId).catch(() => {
      // Ignore cleanup errors
    });
    log(`Download error:`, error);
    throw error;
  }
}
