import { api } from "./api";

/**
 * The gate on the desktop's sync protocol version: a Device sends a desktop
 * nothing newer than it speaks ("send nothing new to an older desktop").
 */
export const desktopSyncProtocolVersion = async (serverUrl: string) =>
  (await api.getInfo(serverUrl)).syncProtocolVersion;

export const desktopSpeaks = async (serverUrl: string, version: number) =>
  (await desktopSyncProtocolVersion(serverUrl)) >= version;
