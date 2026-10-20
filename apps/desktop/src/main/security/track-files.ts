import defaultDb from "../../api/db";
import { listTrackFilePaths } from "../../api/audiobooks/catalog";
import { createTrackFileAllowlist } from "./path-confinement";

/**
 * The Audiobook Track files `local-file://` lets through. The Audiobooks router
 * calls `tracksChanged` whenever it adds, moves or removes Tracks.
 */
export const trackFiles = createTrackFileAllowlist(() => listTrackFilePaths(defaultDb));
