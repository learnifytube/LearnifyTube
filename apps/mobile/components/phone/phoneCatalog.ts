import type { StreamingVideo } from "../../stores/playback";
import type { MovieHold } from "../../services/held-movies/types";

export const CONTINUE_WATCHING_ID = "continue-watching";
export const ON_THIS_PHONE_ID = "on-this-phone";
export const RECENTLY_ADDED_ID = "recently-added";
export const SENT_TO_THIS_PHONE_ID = "sent-to-this-phone";

export type PhoneHomeRow = {
  id: string;
  title: string;
  videos: StreamingVideo[];
  /** On this phone only: the held Movies and Episodes, which never join a Play queue. */
  movies?: MovieHold[];
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
  /** Movies and Episodes held on this phone, arrived or still Downloading. */
  heldMovies?: MovieHold[];
  hasMovieOfflineCopy?: (id: string) => boolean;
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

  const onThisPhoneVideos = (input.onThisPhone ?? [])
    .filter((video) => hasOfflineCopy(video.id))
    .map((video) => ({
      ...video,
      thumbnailUrl: getStoredThumbnail(video.id) ?? video.thumbnailUrl,
    }));
  const hasMovieOfflineCopy = input.hasMovieOfflineCopy ?? (() => false);
  const onThisPhoneMovies = [...(input.heldMovies ?? [])]
    .filter((hold) => hasMovieOfflineCopy(hold.id))
    .sort((a, b) => b.heldAt - a.heldAt);
  if (onThisPhoneVideos.length > 0 || onThisPhoneMovies.length > 0) {
    rows.push({
      id: ON_THIS_PHONE_ID,
      title: "On this phone",
      videos: onThisPhoneVideos,
      movies: onThisPhoneMovies,
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
