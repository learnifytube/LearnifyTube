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

  /** Where playing the List picks up (the shared List rule), or null when it is empty. */
  const whereResumes = ({
    videos,
    collection,
  }: {
    videos: StreamingVideo[];
    collection: CollectionRef;
  }) =>
    whereListPicksUp(
      videos.map((video) => ({
        ...video,
        watched: platform.isWatched(video),
      })),
      platform.currentVideos.get(collection)?.videoId ?? null,
    );

  return {
    start,
    whereResumes,
    /** Plays the List from where it picks up. */
    resume: (
      options: Omit<StartOptions, "startIndex" | "collection"> & {
        collection: CollectionRef;
      },
    ) => {
      const picked = whereResumes(options);
      return start({
        ...options,
        startIndex: picked
          ? options.videos.findIndex((video) => video.id === picked.id)
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
