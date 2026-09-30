import type {
  SavedPlaylistWithItems,
  getAllSavedPlaylistsWithProgress,
} from "../../db/repositories/playlists";
import type { StreamingVideo } from "../../stores/playback";
import type { RemotePlaylist, RemoteVideoWithStatus } from "../../types";
import type { TVCatalogDesktop } from "./tvCatalog";

export type ChannelVideo = Pick<
  RemoteVideoWithStatus,
  "id" | "title" | "channelTitle" | "duration" | "thumbnailUrl"
>;

/** The channel's playlists and Videos: what the desktop answered, or what the TV holds. */
export type TVChannelContents = {
  from: "desktop" | "held";
  playlists: RemotePlaylist[];
  videos: ChannelVideo[];
};

/** A playlist the viewer opened inside the channel. */
export type TVOpenPlaylist = {
  id: string;
  title: string;
  from: "desktop" | "held";
  videos: ChannelVideo[];
};

export type TVChannelDesktop = TVCatalogDesktop & {
  videoThumbnailUrl: (videoId: string) => string;
};

export type TVChannelViewInput = {
  channel: { id?: string; title: string };
  contents: TVChannelContents;
  open: TVOpenPlaylist | null;
  /** Null unless the Desktop connection is connected: Offline mode. */
  desktop: TVChannelDesktop | null;
  hasOfflineCopy: (videoId: string) => boolean;
  getStoredThumbnail: (videoId: string) => string | null;
};

/** What pressing a channel card does. */
export type TVChannelCardAction =
  | { kind: "openPlaylist"; playlistId: string; title: string }
  | {
      kind: "play";
      queue: {
        id: string;
        title: string;
        videos: StreamingVideo[];
        startIndex: number;
      };
    };

export type TVChannelCard = {
  id: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  action: TVChannelCardAction;
};

/**
 * The channel screen's cards. A channel with playlists shows them; otherwise, or
 * inside an open playlist, its Videos. A list from what the TV holds, or any list
 * in Offline mode, shows and plays only held Videos, like the TV catalog.
 */
export function buildTVChannelView(input: TVChannelViewInput) {
  const { channel, contents, open, hasOfflineCopy, getStoredThumbnail } = input;
  const list = open ?? contents;
  // Desktop asset URLs only for a list the desktop answered while it's connected.
  const desktop = list.from === "desktop" ? input.desktop : null;

  if (!open && contents.playlists.length > 0) {
    return {
      cards: contents.playlists.map<TVChannelCard>((item) => ({
        id: item.playlistId,
        title: item.title,
        subtitle: `${item.downloadedCount} ready`,
        thumbnailUrl: desktop
          ? (desktop.resolveAssetUrl(item.thumbnailUrl) ??
            desktop.playlistThumbnailUrl(item.playlistId))
          : item.thumbnailUrl,
        action: {
          kind: "openPlaylist",
          playlistId: item.playlistId,
          title: item.title,
        },
      })),
      emptyText: "No playlists or videos",
    };
  }

  const videos = (
    desktop
      ? list.videos
      : list.videos.filter((item) => hasOfflineCopy(item.id))
  ).map<StreamingVideo>((item) => ({
    id: item.id,
    title: item.title,
    channelTitle: item.channelTitle,
    duration: item.duration,
    thumbnailUrl:
      getStoredThumbnail(item.id) ??
      (desktop
        ? (desktop.resolveAssetUrl(item.thumbnailUrl) ??
          desktop.videoThumbnailUrl(item.id))
        : item.thumbnailUrl) ??
      undefined,
  }));
  const queueId = open
    ? `playlist-${open.id}`
    : `channel-${channel.id ?? channel.title}`;
  const queueTitle = open?.title ?? (channel.title || "Channel");

  return {
    cards: videos.map<TVChannelCard>((item, index) => ({
      id: item.id,
      title: item.title,
      subtitle: item.channelTitle,
      thumbnailUrl: item.thumbnailUrl ?? null,
      action: {
        kind: "play",
        queue: { id: queueId, title: queueTitle, videos, startIndex: index },
      },
    })),
    emptyText: open
      ? "No videos in this playlist"
      : desktop
        ? "No playlists or videos"
        : "Nothing from this channel is on this TV.",
  };
}

export type SavedCollectionSummary = Pick<
  ReturnType<typeof getAllSavedPlaylistsWithProgress>[number],
  | "id"
  | "type"
  | "title"
  | "sourceId"
  | "thumbnailUrl"
  | "downloadedCount"
  | "totalCount"
>;

export type SavedCollectionItems = {
  items: Pick<
    SavedPlaylistWithItems["items"][number],
    "videoId" | "title" | "channelTitle" | "duration" | "thumbnailUrl"
  >[];
};

/** A cached playlist's Videos that the TV holds. */
export function heldPlaylistVideos(
  playlist: SavedCollectionItems,
  hasOfflineCopy: (videoId: string) => boolean,
) {
  return playlist.items
    .filter((item) => hasOfflineCopy(item.videoId))
    .map<ChannelVideo>((item) => ({
      id: item.videoId,
      title: item.title,
      channelTitle: item.channelTitle,
      duration: item.duration,
      thumbnailUrl: item.thumbnailUrl ?? null,
    }));
}

/**
 * What the TV holds from a channel: its cached playlists holding a Video, and the
 * held Videos of the cached channel and of the library. `known` says whether the
 * channel was ever loaded, so an empty result isn't an error.
 */
export function heldChannelContents(input: {
  channel: { id?: string; title: string };
  saved: SavedCollectionSummary[];
  getSavedPlaylist: (id: string) => SavedCollectionItems | undefined;
  library: (Omit<ChannelVideo, "thumbnailUrl"> & {
    thumbnailUrl?: string | null;
  })[];
  hasOfflineCopy: (videoId: string) => boolean;
}) {
  const { channel, saved, hasOfflineCopy } = input;
  const summary = saved.find(
    (item) =>
      item.type === "channel" &&
      ((channel.id ? item.sourceId === channel.id : false) ||
        item.title === channel.title),
  );
  const cachedChannel = summary
    ? input.getSavedPlaylist(summary.id)
    : undefined;
  const cachedVideoIds = new Set(
    cachedChannel?.items.map((item) => item.videoId),
  );

  const playlists = channel.id
    ? saved
        .filter(
          (item) =>
            item.type === "playlist" &&
            item.sourceId === channel.id &&
            item.downloadedCount > 0,
        )
        .map<RemotePlaylist>((item) => ({
          playlistId: item.id.startsWith("playlist_")
            ? item.id.slice("playlist_".length)
            : item.id,
          title: item.title,
          thumbnailUrl: item.thumbnailUrl ?? null,
          itemCount: item.totalCount,
          channelId: item.sourceId ?? null,
          type: "custom",
          downloadedCount: item.downloadedCount,
        }))
    : [];

  const libraryVideos = input.library
    .filter(
      (item) =>
        item.channelTitle === channel.title &&
        !cachedVideoIds.has(item.id) &&
        hasOfflineCopy(item.id),
    )
    .map<ChannelVideo>((item) => ({
      id: item.id,
      title: item.title,
      channelTitle: item.channelTitle,
      duration: item.duration,
      thumbnailUrl: item.thumbnailUrl ?? null,
    }));

  const contents: TVChannelContents & { known: boolean } = {
    from: "held",
    playlists,
    videos: [
      ...(cachedChannel
        ? heldPlaylistVideos(cachedChannel, hasOfflineCopy)
        : []),
      ...libraryVideos,
    ],
    known: !!summary,
  };
  return contents;
}
