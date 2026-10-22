import { z } from "zod";

// v2: the On-device set and Device reports (Offline copies held, Watch state).
// v3: Audiobooks (catalog, Track files, covers).
// v4: Movies and Series (catalog, Movie and Episode files, posters, Movie watch in Device reports).
export const MOBILE_SYNC_PROTOCOL_VERSION = 4;
export const MIN_SUPPORTED_DESKTOP_SYNC_PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_MOBILE_SYNC_PROTOCOL_VERSION = 1;
/** The first desktop protocol that serves the On-device set; older desktops leave Devices alone. */
export const ON_DEVICE_SET_SYNC_PROTOCOL_VERSION = 2;
/** The first desktop protocol that serves Audiobooks; Devices hide them on older desktops. */
export const AUDIOBOOKS_SYNC_PROTOCOL_VERSION = 3;
/** The first desktop protocol that serves Movies and Series; Devices hide them on older desktops. */
export const MOVIES_SYNC_PROTOCOL_VERSION = 4;

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
  /** Watch progress of Movies and Episodes played on the Device; absent from Devices older than Movies. */
  movieWatch: z.array(movieWatchSchema).optional(),
  /** Movies with an Offline copy on the Device, sent or downloaded there; absent from Devices older than Movies. */
  heldMovieIds: z.array(z.string()).optional(),
  /** Episodes with an Offline copy on the Device; absent from Devices older than Movies. */
  heldEpisodeIds: z.array(z.string()).optional(),
});

export type DeviceReport = z.infer<typeof deviceReportSchema>;

/** Server-Sent Events emitted by GET /api/events */
export const SYNC_SSE_EVENT_ON_DEVICE_SET = "sync:on-device-set";
/** The Audiobooks sent to Devices changed (sent, removed from Devices, forgotten or rescanned). */
export const SYNC_SSE_EVENT_AUDIOBOOKS = "sync:audiobooks";
/** The Movies and Seasons sent to Devices, or the titles Shown on Devices, changed. */
export const SYNC_SSE_EVENT_MOVIES = "sync:movies";
/** How often GET /api/events writes a comment, so a Device can tell a dropped stream from a quiet one. */
export const SYNC_SSE_HEARTBEAT_MS = 25_000;

/** One audio file of an Audiobook. Its file is GET /api/audiobook-track/:id/file. */
export const audiobookTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationSeconds: z.number().min(0).nullable(),
  /** The file was gone at the last Rescan; Devices skip it. */
  missing: z.boolean(),
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
});

export type Series = z.infer<typeof seriesSchema>;

/** GET /api/movies: every Movie and Series Shown on Devices, by title. */
export const movieCatalogSchema = z.object({
  movies: z.array(movieSchema),
  series: z.array(seriesSchema),
});

export type MovieCatalog = z.infer<typeof movieCatalogSchema>;
