import { whereListPicksUp } from "../../../shared/list-pickup";
import type {
  CollectionRef,
  LastEpisode,
  Movie,
  MovieWatch,
  OnDeviceSet,
  Series,
} from "../../../shared/mobile-sync-contract";
import { watchStateOf, resumeAt } from "../../services/movie-watch/movieWatch";
import {
  heldSeries,
  seriesEpisodes,
  seriesNextUp,
} from "../../services/movie-watch/seriesWatch";
import type { HeldTitle } from "../../services/held-movies/types";
import type { StreamingVideo } from "../../stores/playback";
import {
  remoteCollectionOfQueueId,
  type RemoteCollectionKind,
} from "../../services/remote-collection/queueId";
import type {
  TVHistoryEntry,
  TVRecentMovie,
  TVRecentPlaylist,
  TVRecentSeries,
} from "../../stores/tvHistory";
import { formatPlaybackTime } from "../playerSeek";
import type { RemoteChannel, RemoteMyList, RemotePlaylist } from "../../types";

export type TVBrowseMode =
  "playlists" | "mylists" | "channels" | "movies" | "series" | "history";

/** The tabs in the order the TV home shows them. */
const TAB_ORDER: TVBrowseMode[] = [
  "playlists",
  "mylists",
  "channels",
  "movies",
  "series",
  "history",
];

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
  history: TVHistoryEntry[];
  /** The desktop's Movies (its latest catalog); empty on a desktop too old to serve them. */
  movies: Movie[];
  /** Where this TV last stopped in a Movie. */
  keptMovieWatch: (movieId: string) => MovieWatch | undefined;
  /** The desktop's Series, from the same catalog as `movies`. */
  series: Series[];
  /** Where this TV last stopped in an Episode. */
  keptEpisodeWatch: (episodeId: string) => MovieWatch | undefined;
  /** The Episode a Series last played on this TV. */
  keptLastEpisode?: (seriesId: string) => LastEpisode | undefined;
  /** The Movies and Episodes whose Offline copy is on this TV. */
  heldTitles: HeldTitle[];
  /** The List or YouTube playlist a History queue plays, once the desktop named it. */
  collectionOf?: (playlistId: string) => CollectionRef | null;
  /** The id of a collection's Current Video as this TV knows it (newest wins). */
  currentVideoOf?: (collection: CollectionRef) => string | null;
  /** Whether this TV counts the Video as watched. */
  isWatched?: (video: StreamingVideo) => boolean;
};

/** What pressing a card does. */
export type TVCardAction =
  | {
      kind: "play";
      playlistId: string;
      title: string;
      videos: StreamingVideo[];
      startIndex: number;
      /** The List or YouTube playlist played; its Current Video follows the queue. */
      collection?: CollectionRef;
    }
  | {
      kind: "remote";
      /** Which desktop endpoint the collection loads from. */
      endpoint: RemoteCollectionKind;
      id: string;
      title: string;
      /** Starts where the List picks up (its Current Video) instead of the first Video. */
      resume?: boolean;
    }
  | { kind: "channel"; id: string; title: string }
  | { kind: "movie"; movieId: string; title: string }
  /** Opens the Series screen. */
  | { kind: "series"; seriesId: string; title: string }
  /** Plays an Episode, then the ones after it; `title` is the Series'. */
  | { kind: "episode"; episodeId: string; title: string };

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
  movies: "No Movies here yet",
  series: "No Series here yet",
  history: "No history yet",
};

const offlineEmptyText: Record<TVBrowseMode, string> = {
  playlists: "No playlists on this TV",
  mylists: "No lists on this TV",
  channels: "No channels on this TV",
  movies: "No Movies on this TV",
  series: "No Series on this TV",
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

/** How far into a Movie or Episode a press starts, else that it was watched, else its length. */
export function describeTitleWatch(
  title: Pick<Movie, "watch" | "durationSeconds">,
  kept: MovieWatch | undefined,
): string {
  const progress = {
    watch: title.watch,
    kept,
    durationSeconds: title.durationSeconds,
  };
  const { state } = watchStateOf(progress);
  if (state === "watched") return "Watched";
  if (state === "in-progress") {
    return `Resume at ${formatPlaybackTime(resumeAt(progress))}`;
  }
  if (!title.durationSeconds) return "";
  const minutes = Math.max(1, Math.round(title.durationSeconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/** A held Movie as the TV shows it when the saved catalog doesn't list it. */
const movieOfHeldTitle = (title: HeldTitle): Movie => ({
  id: title.id,
  title: title.title,
  posterUrl: null,
  durationSeconds: title.durationSeconds,
  missing: false,
  captions: [],
  sentToDevices: false,
  watch: null,
});

const countEpisodes = (count: number) =>
  count === 1 ? "1 Episode" : `${count} Episodes`;

/** How a Series card says where it picks up, and the Episode that plays then (null once watched). */
function seriesPickUp(
  series: Series,
  input: Pick<TVCatalogInput, "keptEpisodeWatch" | "keptLastEpisode">,
) {
  const keptEpisode = input.keptEpisodeWatch;
  const playable = seriesEpisodes(series).filter((item) => !item.missing);
  const next = seriesNextUp(
    series,
    keptEpisode,
    input.keptLastEpisode?.(series.id),
  );
  if (!next) return { subtitle: "Watched", episode: null };
  const { episode } = next;
  const progress = {
    watch: episode.watch,
    kept: keptEpisode(episode.id),
    durationSeconds: episode.durationSeconds,
  };
  const subtitle =
    watchStateOf(progress).state === "in-progress"
      ? `Resume ${episode.title} at ${formatPlaybackTime(resumeAt(progress))}`
      : next.lastWatchedAt === null
        ? countEpisodes(playable.length)
        : `Next: ${episode.title}`;
  return { subtitle, episode };
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

  // Offline, only the Movies the TV holds play, including any the saved catalog no longer lists.
  const heldIds = new Set(input.heldTitles.map((title) => title.id));
  const playableMovies = desktop
    ? input.movies.filter((movie) => !movie.missing)
    : [
        ...input.movies.filter((movie) => heldIds.has(movie.id)),
        ...input.heldTitles.flatMap((title) =>
          title.kind === "movie" &&
          !input.movies.some((movie) => movie.id === title.id)
            ? [movieOfHeldTitle(title)]
            : [],
        ),
      ];
  const movieCard = (movie: Movie, subtitlePrefix = ""): TVCatalogCard => ({
    id: `movie:${movie.id}`,
    title: movie.title,
    subtitle: `${subtitlePrefix}${describeTitleWatch(movie, input.keptMovieWatch(movie.id))}`,
    thumbnailUrl: desktop?.resolveAssetUrl(movie.posterUrl) ?? null,
    action: { kind: "movie", movieId: movie.id, title: movie.title },
  });

  // A Movie in History plays as the desktop lists it now; one it no longer shows is left out.
  const movieHistoryCard = (entry: TVRecentMovie): TVCatalogCard[] => {
    const movie = playableMovies.find((item) => item.id === entry.movieId);
    return movie ? [movieCard(movie, "Movie · ")] : [];
  };

  // Offline, a Series shows only the Episodes the TV holds.
  const playableSeries = desktop
    ? input.series.filter((item) =>
        seriesEpisodes(item).some((episode) => !episode.missing),
      )
    : input.series.flatMap((item) => {
        const held = heldSeries(item, (id) => heldIds.has(id));
        return held ? [held] : [];
      });
  const seriesCard = (series: Series): TVCatalogCard => ({
    id: `series:${series.id}`,
    title: series.title,
    subtitle: seriesPickUp(series, input).subtitle,
    thumbnailUrl: desktop?.resolveAssetUrl(series.posterUrl) ?? null,
    action: { kind: "series", seriesId: series.id, title: series.title },
  });

  // A Series in History plays its next-up Episode; a watched one opens the Series.
  const seriesHistoryCard = (entry: TVRecentSeries): TVCatalogCard[] => {
    const series = playableSeries.find((item) => item.id === entry.seriesId);
    if (!series) return [];
    const { subtitle, episode } = seriesPickUp(series, input);
    const card = seriesCard(series);
    return [
      {
        ...card,
        subtitle: `Series · ${subtitle}`,
        action: episode
          ? { kind: "episode", episodeId: episode.id, title: series.title }
          : card.action,
      },
    ];
  };

  const videoHistoryCard = (entry: TVRecentPlaylist): TVCatalogCard[] => {
    // In Offline mode only the Videos the TV holds can play.
    const canPlay = (item: StreamingVideo) =>
      !!desktop || hasOfflineCopy(item.id);
    const videos = entry.videos.filter(canPlay);
    if (videos.length === 0) return [];

    // A List resumes at its Current Video (the shared List rule, over the
    // whole List); any other queue where the TV last was.
    const collection = input.collectionOf?.(entry.playlistId) ?? null;
    const isWatched = input.isWatched ?? (() => false);
    const resumeVideoId = collection
      ? (whereListPicksUp(
          entry.videos.map((item) => ({
            id: item.id,
            watched: isWatched(item),
            missing: !canPlay(item),
          })),
          input.currentVideoOf?.(collection) ?? null,
        )?.id ?? null)
      : (entry.lastVideoId ?? entry.videos[entry.lastIndex]?.id ?? null);
    const startIndex = Math.max(
      0,
      videos.findIndex((item) => item.id === resumeVideoId),
    );
    const current = videos[startIndex];
    const first = videos[0];
    const remote = desktop ? remoteCollectionOfQueueId(entry.playlistId) : null;
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
        // While connected, a List or YouTube playlist loads as the desktop has
        // it now, with its newest Current Video, and resumes there.
        action: remote
          ? {
              kind: "remote" as const,
              endpoint: remote.kind,
              id: remote.id,
              title: entry.title,
              resume: true,
            }
          : {
              kind: "play" as const,
              playlistId: entry.playlistId,
              title: entry.title,
              videos,
              startIndex,
              ...(collection ? { collection } : {}),
            },
      },
    ];
  };

  const historyCards = input.history.flatMap((entry) =>
    entry.kind === "movie"
      ? movieHistoryCard(entry)
      : entry.kind === "series"
        ? seriesHistoryCard(entry)
        : videoHistoryCard(entry),
  );
  const movieCards = playableMovies.map((movie) => movieCard(movie));
  const seriesCards = playableSeries.map(seriesCard);
  // Only the Movies and Series tabs hide when empty: older desktops serve neither.
  const modes = TAB_ORDER.filter((mode) =>
    mode === "movies"
      ? movieCards.length > 0
      : mode === "series"
        ? seriesCards.length > 0
        : true,
  );

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
            endpoint: "playlist",
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
              endpoint: "mylist",
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
        movies: movieCards,
        series: seriesCards,
        history: historyCards,
      },
      modes,
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

  const holdsNothing = held.length === 0 && input.heldTitles.length === 0;
  return {
    tabs: {
      playlists: collectionCards("playlist"),
      mylists: [...sentToThisTV(), ...collectionCards("mylist")],
      channels: channelCards,
      movies: movieCards,
      series: seriesCards,
      history: historyCards,
    },
    modes,
    emptyText: holdsNothing
      ? {
          playlists: NOTHING_HELD_TEXT,
          mylists: NOTHING_HELD_TEXT,
          channels: NOTHING_HELD_TEXT,
          movies: NOTHING_HELD_TEXT,
          series: NOTHING_HELD_TEXT,
          history: NOTHING_HELD_TEXT,
        }
      : offlineEmptyText,
    emptyHint: holdsNothing ? NOTHING_HELD_HINT : null,
    holdsNothing,
  };
}
