import {
  MOVIES_SYNC_PROTOCOL_VERSION,
  movieCatalogSchema,
  type MovieCatalog,
} from "../../../shared/mobile-sync-contract";
import { parseWithSchema } from "../../../shared/schema-utils";

export type MovieCatalogDesktop = {
  getInfo: (serverUrl: string) => Promise<{ syncProtocolVersion: number }>;
  /** The raw GET /api/movies payload. */
  getMovies: (serverUrl: string) => Promise<unknown>;
};

const NONE: MovieCatalog = { movies: [], series: [] };

export function createMovieCatalog(desktop: MovieCatalogDesktop) {
  /**
   * Every Movie and Series the desktop shows on Devices, or null on a desktop
   * too old to serve them.
   */
  const served = async (serverUrl: string) => {
    const info = await desktop.getInfo(serverUrl);
    if (info.syncProtocolVersion < MOVIES_SYNC_PROTOCOL_VERSION) return null;
    const payload = await desktop.getMovies(serverUrl);
    return parseWithSchema(movieCatalogSchema, payload);
  };

  return {
    served,
    /** Every Movie and Series on the desktop; none on a desktop too old to serve them. */
    load: async (serverUrl: string) => (await served(serverUrl)) ?? NONE,
  };
}
