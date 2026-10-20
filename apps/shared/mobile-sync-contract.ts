import { z } from "zod";

// v2: the On-device set and Device reports (Offline copies held, Watch state).
// v3: Audiobooks (catalog, Track files, covers).
export const MOBILE_SYNC_PROTOCOL_VERSION = 3;
export const MIN_SUPPORTED_DESKTOP_SYNC_PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_MOBILE_SYNC_PROTOCOL_VERSION = 1;
/** The first desktop protocol that serves the On-device set; older desktops leave Devices alone. */
export const ON_DEVICE_SET_SYNC_PROTOCOL_VERSION = 2;
/** The first desktop protocol that serves Audiobooks; Devices hide them on older desktops. */
export const AUDIOBOOKS_SYNC_PROTOCOL_VERSION = 3;

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
    })
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
    })
  ),
  /** Listening positions kept on the Device; absent from Devices older than Audiobooks. */
  listening: z.array(audiobookListeningSchema).optional(),
  /** Audiobooks wholly on the Device (every Track that isn't missing); absent from older Devices. */
  heldAudiobookIds: z.array(z.string()).optional(),
});

export type DeviceReport = z.infer<typeof deviceReportSchema>;

/** Server-Sent Events emitted by GET /api/events */
export const SYNC_SSE_EVENT_ON_DEVICE_SET = "sync:on-device-set";
/** The Audiobooks sent to Devices changed (sent, removed from Devices, forgotten or rescanned). */
export const SYNC_SSE_EVENT_AUDIOBOOKS = "sync:audiobooks";
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
