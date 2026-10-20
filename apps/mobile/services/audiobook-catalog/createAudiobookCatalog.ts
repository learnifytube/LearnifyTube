import {
  AUDIOBOOKS_SYNC_PROTOCOL_VERSION,
  audiobookCatalogSchema,
} from "../../../shared/mobile-sync-contract";
import { parseWithSchema } from "../../../shared/schema-utils";

export type AudiobookCatalogDesktop = {
  getInfo: (serverUrl: string) => Promise<{ syncProtocolVersion: number }>;
  /** The raw GET /api/audiobooks payload. */
  getAudiobooks: (serverUrl: string) => Promise<unknown>;
};

export function createAudiobookCatalog(desktop: AudiobookCatalogDesktop) {
  /** Every Audiobook on the desktop, or null on a desktop too old to serve them. */
  const served = async (serverUrl: string) => {
    const info = await desktop.getInfo(serverUrl);
    if (info.syncProtocolVersion < AUDIOBOOKS_SYNC_PROTOCOL_VERSION)
      return null;
    const payload = await desktop.getAudiobooks(serverUrl);
    return parseWithSchema(audiobookCatalogSchema, payload).audiobooks;
  };

  return {
    served,
    /** Every Audiobook on the desktop; none on a desktop too old to serve them. */
    load: async (serverUrl: string) => (await served(serverUrl)) ?? [],
  };
}
