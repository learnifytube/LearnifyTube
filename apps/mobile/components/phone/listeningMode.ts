import type { TranscriptSegment } from "../../types";
import { currentCaption } from "./captions";

const HOLD_SECONDS = 0.8;

function findActiveSegment(
  segments: TranscriptSegment[] | undefined,
  time: number,
): TranscriptSegment | null {
  if (!segments?.length) return null;
  return (
    segments.find((item) => time >= item.start && time < item.end) ??
    segments.find(
      (item) => time >= item.end && time < item.end + HOLD_SECONDS,
    ) ??
    null
  );
}

/**
 * Finds the start timestamp in seconds of the active spoken sentence
 * at `currentTime`, or null if none is playing.
 */
export function findCurrentSentenceStart(
  segments: TranscriptSegment[] | undefined,
  currentTime: number,
): number | null {
  const active = findActiveSegment(segments, currentTime);
  return active ? active.start : null;
}

export type ListeningDisplayState =
  | { kind: "no-transcript" }
  | { kind: "idle" }
  | { kind: "caption"; text: string; sentenceStart: number };

/**
 * Resolves what to display in Listening mode:
 * - "no-transcript" when transcripts aren't available
 * - "idle" when between segments
 * - "caption" with text and sentence start timestamp for instant tap-to-replay
 */
export function resolveListeningDisplay(
  segments: TranscriptSegment[] | undefined,
  currentTime: number,
  maxChars = Infinity,
): ListeningDisplayState {
  if (!segments?.length) {
    return { kind: "no-transcript" };
  }

  const active = findActiveSegment(segments, currentTime);
  if (!active) {
    return { kind: "idle" };
  }

  const text = currentCaption(segments, currentTime, maxChars);
  if (!text) {
    return { kind: "idle" };
  }

  return {
    kind: "caption",
    text,
    sentenceStart: active.start,
  };
}
