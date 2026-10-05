import type { TranscriptSegment } from "../../types";

/** How long a Caption stays up after its line ends, so short gaps don't flicker. */
const HOLD_SECONDS = 0.8;

/**
 * The Caption on screen at `time` seconds, or null when none. A line longer
 * than `maxChars` is split into evenly sized chunks shown one after another,
 * each for its share of the line's time.
 */
export function currentCaption(
  segments: TranscriptSegment[] | undefined,
  time: number,
  maxChars = Infinity,
): string | null {
  if (!segments?.length) return null;
  const segment =
    segments.find((item) => time >= item.start && time < item.end) ??
    segments.find(
      (item) => time >= item.end && time < item.end + HOLD_SECONDS,
    );
  if (!segment) return null;

  const chunks = splitCaption(segment.text, maxChars);
  if (chunks.length === 0) return null;
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const progress =
    (Math.min(time, segment.end) - segment.start) /
    Math.max(segment.end - segment.start, 0.001);
  let reached = 0;
  for (const chunk of chunks) {
    reached += chunk.length / total;
    if (progress < reached) return chunk;
  }
  return chunks[chunks.length - 1];
}

function splitCaption(text: string, maxChars: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const length = words.join(" ").length;
  if (length === 0) return [];
  const count = Math.ceil(length / maxChars);
  if (count <= 1) return [words.join(" ")];

  const target = length / count;
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > target && chunks.length < count - 1) {
      const overshoot = next.length - target;
      const undershoot = target - current.length;
      if (overshoot > undershoot) {
        chunks.push(current);
        current = word;
        continue;
      }
      chunks.push(next);
      current = "";
      continue;
    }
    current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}
