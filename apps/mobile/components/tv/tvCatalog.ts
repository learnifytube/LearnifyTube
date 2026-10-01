import type { OnDeviceSet } from "../../../shared/mobile-sync-contract";
import type { StreamingVideo } from "../../stores/playback";
import type { TVRecentPlaylist } from "../../stores/tvHistory";
import type { RemoteChannel, RemoteMyList, RemotePlaylist } from "../../types";

export type TVBrowseMode = "playlists" | "mylists" | "channels" | "history";

/** The On-device set's card. The id predates the name and stays, as TV history keeps it. */
export const SENT_TO_THIS_TV_ID = "on-this-tv";
const SENT_TO_THIS_TV_TITLE = "Sent to this TV";

/** A collection from the browse cache, with the Videos it held when last loaded. */
export type CachedCollection = {
  /** The saved playlist id, e.g. `playlist_<id>`. */
  id: string;
  type: "playlist" | "mylist" | "channel";
  title: string;
  sourceId: string | null;
  thumbnailUrl: string | null;
  items: StreamingVideo[];
};

/** The connected desktop, and how to build its asset URLs. */
export type TVCatalogDesktop = {
  url: string;
  resolveAssetUrl: (assetUrl?: string | null) => string | null;
  playlistThumbnailUrl: (playlistId: string) => string;
};

export type TVCatalogInput = {
  /** Null unless the Desktop connection is connected: Offline mode. */
  desktop: TVCatalogDesktop | null;
  remote: {
    playlists: RemotePlaylist[];
    myLists: RemoteMyList[];
    channels: RemoteChannel[];
  };
  cached: CachedCollection[];
  library: StreamingVideo[];
  hasOfflineCopy: (videoId: string) => boolean;
  getStoredThumbnail: (videoId: string) => string | null;
  onDeviceSet: OnDeviceSet["videos"];
  history: TVRecentPlaylist[];
};

/** What pressing a card does. */
export type TVCardAction =
  | {
      kind: "play";
      playlistId: string;
      title: string;
      videos: StreamingVideo[];
      startIndex: number;
    }
  | {
      kind: "remote";
      collection: "playlist" | "mylist";
      id: string;
      title: string;
    }
  | { kind: "channel"; id: string; title: string };

export type TVCatalogCard = {
  id: string;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  action: TVCardAction;
};

const countVideos = (count: number) =>
  count === 1 ? "1 video" : `${count} videos`;

/** A card's total, then how many of its Videos have an Offline copy, when any do. */
const describeCount = (total: number | null, held: number) =>
  [
    total === null ? null : countVideos(total),
    held > 0 ? `${held} on this TV` : null,
  ]
    .filter(Boolean)
    .join(" · ");

const connectedEmptyText: Record<TVBrowseMode, string> = {
  playlists: "No playlists here yet",
  mylists: "No lists here yet",
  channels: "No channels here yet",
  history: "No history yet",
};

const offlineEmptyText: Record<TVBrowseMode, string> = {
  playlists: "No playlists on this TV",
  mylists: "No lists on this TV",
  channels: "No channels on this TV",
  history: "Nothing to resume on this TV",
};

const NOTHING_HELD_TEXT = "Nothing on this TV yet";
const NOTHING_HELD_HINT =
  "Add Videos to the Phone List on the desktop and they'll download to this TV.";

/**
 * A cached collection played from the Videos the TV holds, or null when it holds none.
 * Used in Offline mode, and when the desktop can't open the collection just now.
 */
export function playHeldCollection(
  collection: CachedCollection,
  {
    hasOfflineCopy,
    getStoredThumbnail,
  }: Pick<TVCatalogInput, "hasOfflineCopy" | "getStoredThumbnail">,
) {
  const videos = collection.items
    .filter((item) => hasOfflineCopy(item.id))
    .map((item) => ({
      ...item,
      thumbnailUrl: getStoredThumbnail(item.id) ?? item.thumbnailUrl,
    }));
  if (videos.length === 0) return null;
  return {
    kind: "play" as const,
    playlistId: `offline-${collection.id}`,
    title: collection.title,
    videos,
    startIndex: 0,
  };
}

/** What each TV home tab shows: the desktop's catalog while connected, else only what plays. */
export function buildTVCatalog(input: TVCatalogInput) {
  const { desktop, hasOfflineCopy, getStoredThumbnail } = input;
  const held = input.library.filter((item) => hasOfflineCopy(item.id));

  const collectionCards = (type: "playlist" | "mylist") =>
    input.cached.flatMap((collection) => {
      if (collection.type !== type) return [];
      const action = playHeldCollection(collection, input);
      if (!action) return [];
      return [
        {
          id: collection.id,
          title: collection.title,
          subtitle: countVideos(action.videos.length),
          thumbnailUrl: action.videos[0].thumbnailUrl ?? null,
          action,
        },
      ];
    });

  const heldIn = (cachedId: string) =>
    input.cached
      .find((collection) => collection.id === cachedId)
      ?.items.filter((item) => hasOfflineCopy(item.id)).length ?? 0;

  const sentToThisTV = () => {
    const videos = input.onDeviceSet
      .filter((item) => desktop || hasOfflineCopy(item.id))
      .map((item) => ({
        id: item.id,
        title: item.title,
        channelTitle: item.channelTitle,
        duration: item.duration,
        thumbnailUrl:
          getStoredThumbnail(item.id) ??
          desktop?.resolveAssetUrl(item.thumbnailUrl) ??
          undefined,
      }));
    if (videos.length === 0) return [];
    return [
      {
        id: SENT_TO_THIS_TV_ID,
        title: SENT_TO_THIS_TV_TITLE,
        subtitle: desktop
          ? describeCount(
              videos.length,
              videos.filter((item) => hasOfflineCopy(item.id)).length,
            )
          : countVideos(videos.length),
        thumbnailUrl: videos[0].thumbnailUrl ?? null,
        action: {
          kind: "play" as const,
          playlistId: SENT_TO_THIS_TV_ID,
          title: SENT_TO_THIS_TV_TITLE,
          videos,
          startIndex: 0,
        },
      },
    ];
  };

  const historyCards = input.history.flatMap((entry) => {
    const videos = desktop
      ? entry.videos
      : entry.videos.filter((item) => hasOfflineCopy(item.id));
    if (videos.length === 0) return [];

    const lastVideoId =
      entry.lastVideoId ?? entry.videos[entry.lastIndex]?.id ?? null;
    const startIndex = Math.max(
      0,
      videos.findIndex((item) => item.id === lastVideoId),
    );
    const current = videos[startIndex];
    const first = videos[0];
    return [
      {
        id: entry.playlistId,
        title: entry.title,
        subtitle: `Resume ${startIndex + 1}/${videos.length} - ${current.title}`,
        thumbnailUrl:
          getStoredThumbnail(current.id) ??
          getStoredThumbnail(first.id) ??
          desktop?.resolveAssetUrl(current.thumbnailUrl) ??
          desktop?.resolveAssetUrl(first.thumbnailUrl) ??
          null,
        action: {
          kind: "play" as const,
          playlistId: entry.playlistId,
          title: entry.title,
          videos,
          startIndex,
        },
      },
    ];
  });

  if (desktop) {
    return {
      tabs: {
        playlists: input.remote.playlists.map<TVCatalogCard>((item) => ({
          id: item.playlistId,
          title: item.title,
          subtitle: describeCount(
            item.itemCount,
            heldIn(`playlist_${item.playlistId}`),
          ),
          thumbnailUrl:
            desktop.resolveAssetUrl(item.thumbnailUrl) ??
            desktop.playlistThumbnailUrl(item.playlistId),
          action: {
            kind: "remote",
            collection: "playlist",
            id: item.playlistId,
            title: item.title,
          },
        })),
        mylists: [
          ...sentToThisTV(),
          ...input.remote.myLists.map<TVCatalogCard>((item) => ({
            id: item.id,
            title: item.name,
            subtitle: [
              item.isFavorite ? "Favorite" : null,
              describeCount(item.itemCount, heldIn(`mylist_${item.id}`)),
            ]
              .filter(Boolean)
              .join(" · "),
            thumbnailUrl: desktop.resolveAssetUrl(item.thumbnailUrl),
            action: {
              kind: "remote",
              collection: "mylist",
              id: item.id,
              title: item.name,
            },
          })),
        ],
        channels: input.remote.channels.map<TVCatalogCard>((item) => ({
          id: item.channelId,
          title: item.channelTitle,
          subtitle: describeCount(
            item.videoCount,
            held.filter((video) => video.channelTitle === item.channelTitle)
              .length,
          ),
          thumbnailUrl: desktop.resolveAssetUrl(item.thumbnailUrl),
          action: {
            kind: "channel",
            id: item.channelId,
            title: item.channelTitle,
          },
        })),
        history: historyCards,
      },
      emptyText: connectedEmptyText,
      emptyHint: null,
      holdsNothing: false,
    };
  }

  // Offline Channels come from held Videos; a cached channel of the same name lends its
  // id, so the channel page can find its cached playlists.
  const heldByChannel = new Map<string, StreamingVideo[]>();
  for (const item of held) {
    const channelTitle = item.channelTitle.trim() || "Unknown channel";
    heldByChannel.set(channelTitle, [
      ...(heldByChannel.get(channelTitle) ?? []),
      item,
    ]);
  }
  const channelCards = [...heldByChannel.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map<TVCatalogCard>(([channelTitle, videos]) => {
      const cachedChannel = input.cached.find(
        (collection) =>
          collection.type === "channel" && collection.title === channelTitle,
      );
      const id = cachedChannel?.sourceId ?? channelTitle;
      return {
        id,
        title: channelTitle,
        subtitle: countVideos(videos.length),
        thumbnailUrl: getStoredThumbnail(videos[0].id),
        action: { kind: "channel", id, title: channelTitle },
      };
    });

  const holdsNothing = held.length === 0;
  return {
    tabs: {
      playlists: collectionCards("playlist"),
      mylists: [...sentToThisTV(), ...collectionCards("mylist")],
      channels: channelCards,
      history: historyCards,
    },
    emptyText: holdsNothing
      ? {
          playlists: NOTHING_HELD_TEXT,
          mylists: NOTHING_HELD_TEXT,
          channels: NOTHING_HELD_TEXT,
          history: NOTHING_HELD_TEXT,
        }
      : offlineEmptyText,
    emptyHint: holdsNothing ? NOTHING_HELD_HINT : null,
    holdsNothing,
  };
}
