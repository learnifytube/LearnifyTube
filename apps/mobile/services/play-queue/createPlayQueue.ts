import type {
  CollectionRef,
  CurrentVideo,
} from "../../../shared/mobile-sync-contract";
import { whereListPicksUp } from "../../../shared/list-pickup";
import type { StreamingVideo } from "../../stores/playback";

export type PlayQueueStart = {
  id: string;
  title: string;
  videos: StreamingVideo[];
  startIndex: number;
};

export type PlayQueuePlatform = {
  setQueue: (queue: PlayQueueStart) => void;
  // TV history; null on the phone, which keeps none.
  recordHistory: ((queue: PlayQueueStart) => void) | null;
  /** The Current Videos this Device knows (the desktop's and its own, newest wins). */
  currentVideos: {
    get: (collection: CollectionRef) => CurrentVideo | null;
    /** Keeps a Current Video on the Device and tells the desktop when it can. */
    keep: (currentVideo: CurrentVideo) => void;
  };
  /** Whether the Video is watched (about 90% played) as far as this Device knows. */
  isWatched: (video: StreamingVideo) => boolean;
  now: () => number;
};

/** A Video of a List, and whether this Device can't play it now. */
export type ListVideo = StreamingVideo & { unavailable?: boolean };

/** The Videos of a List this Device can play now, as the queue takes them. */
export const playableVideos = (videos: ListVideo[]): StreamingVideo[] =>
  videos
    .filter((video) => !video.unavailable)
    .map(({ unavailable: _, ...video }) => video);

type StartOptions = Omit<PlayQueueStart, "startIndex"> & {
  startIndex?: number;
  /** The List or YouTube playlist the queue plays; its Current Video follows the queue. */
  collection?: CollectionRef | null;
};

export function createPlayQueue(platform: PlayQueuePlatform) {
  // The collection the queue in play was started from, and the Video last recorded for it.
  let playing: {
    collection: CollectionRef;
    videoIds: Set<string>;
    recorded: string | null;
  } | null = null;

  const record = (videoId: string) => {
    if (!playing || playing.recorded === videoId) return;
    if (!playing.videoIds.has(videoId)) return;
    playing.recorded = videoId;
    platform.currentVideos.keep({
      collectionKind: playing.collection.kind,
      collectionId: playing.collection.id,
      videoId,
      updatedAt: platform.now(),
    });
  };

  // Starts playing `videos` from `startIndex` and returns the Video to open,
  // or null when there is nothing to play. The queue carries no desktop
  // address: players resolve the source when each Video starts.
  const start = ({
    id,
    title,
    videos,
    startIndex = 0,
    collection = null,
  }: StartOptions) => {
    if (videos.length === 0) return null;
    const index = Math.min(Math.max(startIndex, 0), videos.length - 1);
    const queue = { id, title, videos, startIndex: index };
    platform.setQueue(queue);
    platform.recordHistory?.(queue);
    playing = collection
      ? {
          collection,
          videoIds: new Set(videos.map((video) => video.id)),
          recorded: null,
        }
      : null;
    record(videos[index].id);
    return videos[index];
  };

  /**
   * Where playing the List picks up (the shared List rule), or null when
   * nothing in it can play. `videos` is the whole List in order; a Video this
   * Device can't play now (no Offline copy in Offline mode) is skipped.
   */
  const whereResumes = ({
    videos,
    collection,
    currentVideoId = platform.currentVideos.get(collection)?.videoId ?? null,
  }: {
    videos: ListVideo[];
    collection: CollectionRef;
    /** The Current Video as a screen already has it, when it renders from the store. */
    currentVideoId?: string | null;
  }) =>
    whereListPicksUp(
      videos.map((video) => ({
        ...video,
        watched: platform.isWatched(video),
        missing: video.unavailable,
      })),
      currentVideoId,
    );

  return {
    start,
    whereResumes,
    /** Plays the Videos of the List this Device can play, from where it picks up. */
    resume: (
      options: Omit<StartOptions, "startIndex" | "collection" | "videos"> & {
        videos: ListVideo[];
        collection: CollectionRef;
      },
    ) => {
      const picked = whereResumes(options);
      const playable = playableVideos(options.videos);
      return start({
        ...options,
        videos: playable,
        startIndex: picked
          ? playable.findIndex((video) => video.id === picked.id)
          : 0,
      });
    },
    /**
     * A Video started in the queue in play; for a queue started from a List it
     * becomes that List's Current Video.
     */
    videoStarted: record,
  };
}

export type PlayQueue = ReturnType<typeof createPlayQueue>;
