import type { BookAudioPlatform, BookTrack } from "./createBookPlayer";

/**
 * Where a Track plays from: its file on the phone when the phone holds it,
 * else a Stream from the desktop, else nowhere (null). Asked each time a
 * Track starts, so a Track that reached the phone meanwhile plays from it.
 */
export function localFirstTrackUri(sources: {
  /** The Track's file on the phone, or null when it isn't held (or unreachable). */
  held: (track: BookTrack) => Promise<string | null>;
  /** The desktop Stream URL, or null in Offline mode. */
  stream: (track: BookTrack) => string | null;
}): BookAudioPlatform["trackUri"] {
  return async (_book, track) =>
    (await sources.held(track)) ?? sources.stream(track);
}
