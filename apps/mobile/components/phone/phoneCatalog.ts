import type { StreamingVideo } from "../../stores/playback";

export const CONTINUE_WATCHING_ID = "continue-watching";
export const ON_THIS_PHONE_ID = "on-this-phone";
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
  onThisPhone?: StreamingVideo[];
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

/** Home rows: Continue watching, On this phone (if held), then Recently added. */
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

  if (input.onThisPhone && input.onThisPhone.length > 0) {
    const onThisPhoneVideos = input.onThisPhone
      .filter((video) => hasOfflineCopy(video.id))
      .map((video) => ({
        ...video,
        thumbnailUrl: getStoredThumbnail(video.id) ?? video.thumbnailUrl,
      }));
    if (onThisPhoneVideos.length > 0) {
      rows.push({
        id: ON_THIS_PHONE_ID,
        title: "On this phone",
        videos: onThisPhoneVideos,
      });
    }
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
