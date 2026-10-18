import type { TranscriptSegment } from "../../types";
import {
  findCurrentSentenceStart,
  resolveListeningDisplay,
} from "./listeningMode";

const segments: TranscriptSegment[] = [
  { start: 0, end: 2.5, text: "Welcome to this listening lesson." },
  { start: 3.0, end: 5.5, text: "Listen carefully to the pronunciation." },
  { start: 8.0, end: 10.0, text: "Repeat after me." },
];

describe("findCurrentSentenceStart", () => {
  it("returns segment start when currentTime is within the segment", () => {
    expect(findCurrentSentenceStart(segments, 1.2)).toBe(0);
    expect(findCurrentSentenceStart(segments, 3.5)).toBe(3.0);
    expect(findCurrentSentenceStart(segments, 9.9)).toBe(8.0);
  });

  it("returns segment start during hold window just after segment ends", () => {
    // 2.5 + 0.4s hold (within 0.8s hold)
    expect(findCurrentSentenceStart(segments, 2.9)).toBe(0);
  });

  it("returns null during gaps past hold window", () => {
    // 5.5 + 0.8s hold ends at 6.3. At 6.5 it should be null.
    expect(findCurrentSentenceStart(segments, 6.5)).toBe(null);
  });

  it("returns null for empty or undefined segments", () => {
    expect(findCurrentSentenceStart(undefined, 1.0)).toBe(null);
    expect(findCurrentSentenceStart([], 1.0)).toBe(null);
  });
});

describe("resolveListeningDisplay", () => {
  it("returns no-transcript if segments are missing or empty", () => {
    expect(resolveListeningDisplay(undefined, 1.0)).toEqual({
      kind: "no-transcript",
    });
    expect(resolveListeningDisplay([], 1.0)).toEqual({
      kind: "no-transcript",
    });
  });

  it("returns caption and start time when a sentence is active", () => {
    const result = resolveListeningDisplay(segments, 1.0, 100);
    expect(result).toEqual({
      kind: "caption",
      text: "Welcome to this listening lesson.",
      sentenceStart: 0,
    });
  });

  it("returns idle state when between segments and past hold window", () => {
    // 5.5 + 0.8 = 6.3. At 6.5 it should be idle.
    const result = resolveListeningDisplay(segments, 6.5, 100);
    expect(result).toEqual({
      kind: "idle",
    });
  });
});
