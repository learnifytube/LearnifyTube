import type { OnDeviceSet } from "../../../shared/mobile-sync-contract";
import type { StreamingVideo } from "../../stores/playback";
import type { RemoteChannel, RemoteMyList, RemotePlaylist } from "../../types";

export const CONTINUE_WATCHING_ID = "continue-watching";
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
  resolveAssetUrl: (assetUrl?: string | null) => string | null;
  continueWatching: PhoneContinueItem[];
  onDeviceSet: OnDeviceSet["videos"];
  channels: Array<{ channel: RemoteChannel; videos: StreamingVideo[] }>;
  lists: Array<{ list: RemoteMyList; videos: StreamingVideo[] }>;
  playlists: Array<{ playlist: RemotePlaylist; videos: StreamingVideo[] }>;
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

/** Home rows: Continue watching, Sent to this phone, Channels, then Lists (and YouTube playlists). */
export function buildPhoneHome(input: PhoneHomeInput): PhoneHomeRow[] {
  const { connected, hasOfflineCopy, getStoredThumbnail, resolveAssetUrl } =
    input;
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

  const sentVideos = visibleVideos(
    input.onDeviceSet.map((item) => ({
      id: item.id,
      title: item.title,
      channelTitle: item.channelTitle,
      duration: item.duration,
      thumbnailUrl: resolveAssetUrl(item.thumbnailUrl) ?? undefined,
    })),
    connected,
    hasOfflineCopy,
    getStoredThumbnail,
  );
  if (sentVideos.length > 0) {
    rows.push({
      id: SENT_TO_THIS_PHONE_ID,
      title: "Sent to this phone",
      videos: sentVideos,
    });
  }

  for (const { channel, videos } of input.channels) {
    const rowVideos = visibleVideos(
      videos,
      connected,
      hasOfflineCopy,
      getStoredThumbnail,
    );
    if (rowVideos.length === 0) continue;
    rows.push({
      id: `channel-${channel.channelId}`,
      title: channel.channelTitle,
      videos: rowVideos,
    });
  }

  for (const { list, videos } of input.lists) {
    const rowVideos = visibleVideos(
      videos,
      connected,
      hasOfflineCopy,
      getStoredThumbnail,
    );
    if (rowVideos.length === 0) continue;
    rows.push({
      id: `list-${list.id}`,
      title: list.name,
      videos: rowVideos,
    });
  }

  for (const { playlist, videos } of input.playlists) {
    const rowVideos = visibleVideos(
      videos,
      connected,
      hasOfflineCopy,
      getStoredThumbnail,
    );
    if (rowVideos.length === 0) continue;
    rows.push({
      id: `playlist-${playlist.playlistId}`,
      title: playlist.title,
      videos: rowVideos,
    });
  }

  return rows;
}
