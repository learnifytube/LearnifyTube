import type { AudiobookListening } from "./mobile-sync-contract";
import { newestWins } from "./newest-wins";

/** An Audiobook's Listening position merges by the shared newest-wins rule. */
export const newestListening = newestWins;

/**
 * The Track position a Listening position gives its Track (ADR-0006), so a
 * Device that sends only Listening positions still moves it. A finished book
 * says nothing about its Track: only the Track reaching its end makes it played
 * to its end, and that comes as the Track's own position.
 */
export const trackPositionOfListening = (listening: AudiobookListening) =>
  listening.finished
    ? null
    : {
        audiobookId: listening.audiobookId,
        trackId: listening.trackId,
        seconds: listening.seconds,
        playedToEnd: false,
        updatedAt: listening.updatedAt,
      };
