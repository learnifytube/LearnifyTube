import { z } from "zod";

// v2: the On-device set and Device reports (Offline copies held, Watch state).
export const MOBILE_SYNC_PROTOCOL_VERSION = 2;
export const MIN_SUPPORTED_DESKTOP_SYNC_PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_MOBILE_SYNC_PROTOCOL_VERSION = 1;
/** The first desktop protocol that serves the On-device set; older desktops leave Devices alone. */
export const ON_DEVICE_SET_SYNC_PROTOCOL_VERSION = 2;

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
});

export type DeviceReport = z.infer<typeof deviceReportSchema>;
