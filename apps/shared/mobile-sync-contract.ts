import { z } from "zod";
import { COLLECTION_KINDS } from "./collection-kinds";

// v2: the On-device set and Device reports (Offline copies held, Watch state).
// v3: Audiobooks (catalog, Track files, covers).
// v4: Movies and Series (catalog, Movie and Episode files, posters, Movie watch in Device reports).
// v5: Resume everywhere (Track positions, Current Videos, each Series' last Episode; ADR-0006).
export const MOBILE_SYNC_PROTOCOL_VERSION = 5;
export const MIN_SUPPORTED_DESKTOP_SYNC_PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_MOBILE_SYNC_PROTOCOL_VERSION = 1;
/** The first desktop protocol that serves the On-device set; older desktops leave Devices alone. */
export const ON_DEVICE_SET_SYNC_PROTOCOL_VERSION = 2;
/** The first desktop protocol that serves Audiobooks; Devices hide them on older desktops. */
export const AUDIOBOOKS_SYNC_PROTOCOL_VERSION = 3;
/** The first desktop protocol that serves Movies and Series; Devices hide them on older desktops. */
export const MOVIES_SYNC_PROTOCOL_VERSION = 4;
/**
 * The first protocol that shares where each file and collection resumes (Track positions,
 * Current Videos, each Series' last Episode); neither side sends them to an older peer.
 */
export const RESUME_SYNC_PROTOCOL_VERSION = 5;

export const syncServerInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  videoCount: z.number().int().min(0),
  syncProtocolVersion: z.number().int().positive(),
  minSupportedMobileSyncProtocolVersion: z.number().int().positive(),
});

export type SyncServerInfo = z.infer<typeof syncServerInfoSchema>;

/** GET /api/on-device-set: the Videos the desktop wants every Device to hold. */
export const onDeviceSetSchema = z.object({
  videos: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      channelTitle: z.string(),
      duration: z.number(),
      thumbnailUrl: z.string().nullable(),
    }),
  ),
});

export type OnDeviceSet = z.infer<typeof onDeviceSetSchema>;

/** Where the user is in an Audiobook: one Track and a time inside it. The newest updatedAt wins. */
export const listeningPositionSchema = z.object({
  trackId: z.string(),
  seconds: z.number().min(0),
  updatedAt: z.number(),
});

export type ListeningPosition = z.infer<typeof listeningPositionSchema>;

/**
 * A Device's Listening position in one Audiobook, and whether it played to the end.
 * Sent in the Device report and, while playing, to POST /api/audiobook/:id/listening.
 */
export const audiobookListeningSchema = listeningPositionSchema.extend({
  audiobookId: z.string(),
  finished: z.boolean(),
});

export type AudiobookListening = z.infer<typeof audiobookListeningSchema>;

/**
 * Where the user stopped in one Track, and whether it was played to its end
 * (ADR-0006). The newest updatedAt wins; a Start over records one too, so older
 * positions lose to it. A Track played to its end starts again from 0.
 */
export const trackPositionSchema = z.object({
  seconds: z.number().min(0),
  playedToEnd: z.boolean(),
  updatedAt: z.number(),
});

export type TrackPosition = z.infer<typeof trackPositionSchema>;

/**
 * A Device's Track position in one Track of an Audiobook. Sent in the Device
 * report and, while playing, to POST /api/audiobook/:id/track-position.
 * Only sent to desktops at RESUME_SYNC_PROTOCOL_VERSION or newer.
 */
export const audiobookTrackPositionSchema = trackPositionSchema.extend({
  audiobookId: z.string(),
  trackId: z.string(),
});

export type AudiobookTrackPosition = z.infer<
  typeof audiobookTrackPositionSchema
>;

/** Whether a played file is a Movie or an Episode of a Series (ADR-0005). */
export const movieKindSchema = z.enum(["movie", "episode"]);

export type MovieKind = z.infer<typeof movieKindSchema>;

/**
 * Where a Device stopped in a Movie or Episode (ADR-0005), sent in the Device
 * report. The desktop takes it unless its own Watch state of that title changed
 * since (a desktop mark wins).
 */
export const movieWatchSchema = z.object({
  kind: movieKindSchema,
  /** The Movie id or the Episode id. */
  id: z.string(),
  lastPositionSeconds: z.number().min(0),
  lastWatchedAt: z.number(),
});

export type MovieWatch = z.infer<typeof movieWatchSchema>;

/** The collections that remember a Current Video (ADR-0006); Channels don't. */
export const collectionKindSchema = z.enum(COLLECTION_KINDS);

export type CollectionKind = z.infer<typeof collectionKindSchema>;

/** A List (Favorites included) or YouTube playlist: the collections with a Current Video. */
export const collectionRefSchema = z.object({
  kind: collectionKindSchema,
  id: z.string(),
});

export type CollectionRef = z.infer<typeof collectionRefSchema>;

/**
 * The Video a List (Favorites included) or YouTube playlist was last playing.
 * Sent in the Device report; the newest updatedAt wins. Favorites' id is "favorites".
 */
export const currentVideoSchema = z.object({
  collectionKind: collectionKindSchema,
  collectionId: z.string(),
  videoId: z.string(),
  updatedAt: z.number(),
});

export type CurrentVideo = z.infer<typeof currentVideoSchema>;

/**
 * GET /api/playlist/:id/videos and GET /api/mylist/:id/videos ("favorites" for
 * Favorites) carry, beside `videos`, `collection` (which List or YouTube playlist
 * the id named) and `currentVideo`: the collection's Current Video, or null when
 * none is set. Both absent from desktops older than RESUME_SYNC_PROTOCOL_VERSION.
 */
export const collectionVideosCurrentVideoSchema = z.object({
  collection: collectionRefSchema.optional(),
  currentVideo: currentVideoSchema.nullable().optional(),
});

/**
 * Each Video in those endpoints' `videos` carries, beside its other fields,
 * `watched`: the desktop's Watch state (about 90% played, or marked watched), so
 * a Device's List rule and start position agree with the desktop. Absent from
 * desktops older than RESUME_SYNC_PROTOCOL_VERSION.
 */
export const collectionVideoWatchSchema = z.object({
  id: z.string(),
  watched: z.boolean().optional(),
});

export type CollectionVideoWatch = z.infer<typeof collectionVideoWatchSchema>;

/**
 * POST /api/collection/current-video: a Device started a Video in a List or
 * YouTube playlist (the body is a CurrentVideo); the newest one is kept.
 */
export const COLLECTION_CURRENT_VIDEO_PATH = "/api/collection/current-video";

/**
 * The Episode a Series last played (ADR-0006), and when that changed. Null
 * `episodeId` means forgotten (the Series, or that Episode's Season, was marked
 * unwatched on the desktop). The newest updatedAt wins.
 */
export const lastEpisodeSchema = z.object({
  episodeId: z.string().nullable(),
  updatedAt: z.number(),
});

export type LastEpisode = z.infer<typeof lastEpisodeSchema>;

/** A Series' last Episode as a Device keeps it, sent in the Device report. */
export const seriesLastEpisodeSchema = lastEpisodeSchema.extend({
  seriesId: z.string(),
});

export type SeriesLastEpisode = z.infer<typeof seriesLastEpisodeSchema>;

/** POST /api/devices/report: what a Device holds and what was watched on it. */
export const deviceReportSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string(),
  kind: z.enum(["phone", "tv"]),
  /** Every Video with an Offline copy on the Device, in the set or not. */
  offlineVideoIds: z.array(z.string()),
  watch: z.array(
    z.object({
      videoId: z.string(),
      lastPositionSeconds: z.number().min(0),
      lastWatchedAt: z.number(),
    }),
  ),
  /** Listening positions kept on the Device; absent from Devices older than Audiobooks. */
  listening: z.array(audiobookListeningSchema).optional(),
  /** Audiobooks wholly on the Device (every Track that isn't missing); absent from older Devices. */
  heldAudiobookIds: z.array(z.string()).optional(),
  /** Track positions kept on the Device; absent from Devices older than resume (v5). */
  trackPositions: z.array(audiobookTrackPositionSchema).optional(),
  /** Watch progress of Movies and Episodes played on the Device; absent from Devices older than Movies. */
  movieWatch: z.array(movieWatchSchema).optional(),
  /** Movies with an Offline copy on the Device, sent or downloaded there; absent from Devices older than Movies. */
  heldMovieIds: z.array(z.string()).optional(),
  /** Episodes with an Offline copy on the Device; absent from Devices older than Movies. */
  heldEpisodeIds: z.array(z.string()).optional(),
  /** Current Videos of Lists and YouTube playlists played on the Device; absent from Devices older than resume. */
  currentVideos: z.array(currentVideoSchema).optional(),
  /** Each Series' last Episode as the Device has it; absent from Devices older than resume. */
  seriesLastEpisodes: z.array(seriesLastEpisodeSchema).optional(),
});

export type DeviceReport = z.infer<typeof deviceReportSchema>;

/** Server-Sent Events emitted by GET /api/events */
export const SYNC_SSE_EVENT_ON_DEVICE_SET = "sync:on-device-set";
/** The Audiobooks sent to Devices changed (sent, removed from Devices, forgotten or rescanned). */
export const SYNC_SSE_EVENT_AUDIOBOOKS = "sync:audiobooks";
/** The Movies and Seasons sent to Devices, or the titles Shown on Devices, changed. */
export const SYNC_SSE_EVENT_MOVIES = "sync:movies";
/**
 * A List's or YouTube playlist's Current Video changed (resume, v5): a Device
 * showing that collection loads it again. Older Devices ignore it.
 */
export const SYNC_SSE_EVENT_CURRENT_VIDEOS = "sync:current-videos";
/** How often GET /api/events writes a comment, so a Device can tell a dropped stream from a quiet one. */
export const SYNC_SSE_HEARTBEAT_MS = 25_000;

/** One audio file of an Audiobook. Its file is GET /api/audiobook-track/:id/file. */
export const audiobookTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationSeconds: z.number().min(0).nullable(),
  /** The file was gone at the last Rescan; Devices skip it. */
  missing: z.boolean(),
  /** Where this Track resumes; null before it was played. Absent from desktops older than resume (v5). */
  trackPosition: trackPositionSchema.nullable().optional(),
});

export type AudiobookTrack = z.infer<typeof audiobookTrackSchema>;

export const audiobookSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string().nullable(),
  /** GET /api/audiobook/:id/cover, or null for the placeholder. */
  coverUrl: z.string().nullable(),
  /** Every Track in Track order. */
  tracks: z.array(audiobookTrackSchema),
  listeningPosition: listeningPositionSchema.nullable(),
  finished: z.boolean(),
  /** Sent to Devices: every Device holds it as a whole. */
  sentToDevices: z.boolean(),
});

export type Audiobook = z.infer<typeof audiobookSchema>;

/** GET /api/audiobooks: every imported Audiobook. */
export const audiobookCatalogSchema = z.object({
  audiobooks: z.array(audiobookSchema),
});

export type AudiobookCatalog = z.infer<typeof audiobookCatalogSchema>;

/**
 * The desktop's Watch state of a Movie or Episode, so a Device resumes where any
 * device left off. Null before it was ever played or marked.
 */
export const titleWatchSchema = z.object({
  positionSeconds: z.number().min(0),
  watched: z.boolean(),
  /** When the desktop's Watch state last changed; a Device's older progress loses to it. */
  updatedAt: z.number(),
});

export type TitleWatch = z.infer<typeof titleWatchSchema>;

/**
 * A sidecar subtitle file of a Movie or Episode. GET /api/caption/:id serves
 * it as WebVTT (text/vtt), whether the file is .srt or .vtt.
 */
export const captionSchema = z.object({
  id: z.string(),
  /** The language from the file name (`Up.en.srt` -> "en"), if any. */
  language: z.string().nullable(),
  /** What the language picker shows. */
  label: z.string(),
});

export type Caption = z.infer<typeof captionSchema>;

/** A Movie: one video file, GET /api/movie/:id/file (byte ranges). */
export const movieSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** GET /api/movie/:id/poster, or null for the placeholder. */
  posterUrl: z.string().nullable(),
  durationSeconds: z.number().min(0).nullable(),
  /** The file was gone at the last Rescan; Devices can't play it. */
  missing: z.boolean(),
  captions: z.array(captionSchema),
  /** Sent to Devices: every Device holds it. */
  sentToDevices: z.boolean(),
  watch: titleWatchSchema.nullable(),
});

export type Movie = z.infer<typeof movieSchema>;

/** One Episode of a Series: GET /api/episode/:id/file (byte ranges). */
export const episodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** The episode number from the file name (E02 -> 2), if any. */
  number: z.number().int().nullable(),
  durationSeconds: z.number().min(0).nullable(),
  missing: z.boolean(),
  captions: z.array(captionSchema),
  watch: titleWatchSchema.nullable(),
});

export type Episode = z.infer<typeof episodeSchema>;

export const seasonSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** The season number from the file or folder names (S01 -> 1), if any. */
  number: z.number().int().nullable(),
  /** The Season is the unit sent to Devices. */
  sentToDevices: z.boolean(),
  /** Every Episode in Episode order. */
  episodes: z.array(episodeSchema),
});

export type Season = z.infer<typeof seasonSchema>;

export const seriesSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** GET /api/series/:id/poster, or null for the placeholder. */
  posterUrl: z.string().nullable(),
  /** Every Season in order. */
  seasons: z.array(seasonSchema),
  /** The Episode last played; null before any was, absent from desktops older than resume. */
  lastEpisode: lastEpisodeSchema.nullable().optional(),
});

export type Series = z.infer<typeof seriesSchema>;

/** GET /api/movies: every Movie and Series Shown on Devices, by title. */
export const movieCatalogSchema = z.object({
  movies: z.array(movieSchema),
  series: z.array(seriesSchema),
});

export type MovieCatalog = z.infer<typeof movieCatalogSchema>;
