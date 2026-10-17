import type { StreamingVideo } from "../../stores/playback";

export const CONTINUE_WATCHING_ID = "continue-watching";
export const RECENTLY_ADDED_ID = "recently-added";
export const SENT_TO_THIS_PHONE_ID = "sent-to-this-phone";

export type PhoneHomeRow = {
  id: string;
  title: string;
  videos: StreamingVideo[];
};

export type PhoneContinueItem = StreamingVideo & {
  lastPositionSeconds: number;
  lastWatchedAt: number | null;
};

export type PhoneHomeInput = {
  connected: boolean;
  hasOfflineCopy: (videoId: string) => boolean;
  getStoredThumbnail: (videoId: string) => string | null;
  resolveAssetUrl?: (assetUrl?: string | null) => string | null;
  continueWatching: PhoneContinueItem[];
  recentlyAdded: StreamingVideo[];
};

const visibleVideos = (
  videos: StreamingVideo[],
  connected: boolean,
  hasOfflineCopy: (videoId: string) => boolean,
  getStoredThumbnail: (videoId: string) => string | null,
): StreamingVideo[] =>
  videos
    .filter((video) => connected || hasOfflineCopy(video.id))
    .map((video) => ({
      ...video,
      thumbnailUrl: getStoredThumbnail(video.id) ?? video.thumbnailUrl,
    }));

/** Home rows: Continue watching, then Recently added. */
export function buildPhoneHome(input: PhoneHomeInput): PhoneHomeRow[] {
  const { connected, hasOfflineCopy, getStoredThumbnail } = input;
  const rows: PhoneHomeRow[] = [];

  const continueVideos = visibleVideos(
    input.continueWatching,
    connected,
    hasOfflineCopy,
    getStoredThumbnail,
  );
  if (continueVideos.length > 0) {
    rows.push({
      id: CONTINUE_WATCHING_ID,
      title: "Continue watching",
      videos: continueVideos,
    });
  }

  const recentVideos = visibleVideos(
    input.recentlyAdded,
    connected,
    hasOfflineCopy,
    getStoredThumbnail,
  );
  if (recentVideos.length > 0) {
    rows.push({
      id: RECENTLY_ADDED_ID,
      title: "Recently added",
      videos: recentVideos,
    });
  }

  return rows;
}
