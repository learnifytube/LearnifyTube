import type { TranscriptSegment } from "../../types";

/** The Caption line on screen at `time` seconds, or null when none. */
export function currentCaption(
  segments: TranscriptSegment[] | undefined,
  time: number,
): string | null {
  if (!segments?.length) return null;
  const segment = segments.find((item) => time >= item.start && time < item.end);
  return segment?.text ?? null;
}
