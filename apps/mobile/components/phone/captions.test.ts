import { currentCaption } from "./captions";
import type { TranscriptSegment } from "../../types";

const segments: TranscriptSegment[] = [
  { start: 0, end: 2, text: "Hello" },
  { start: 2, end: 5, text: "there" },
];

describe("currentCaption", () => {
  it("returns the line covering the playback time", () => {
    expect(currentCaption(segments, 0)).toBe("Hello");
    expect(currentCaption(segments, 1.9)).toBe("Hello");
    expect(currentCaption(segments, 2)).toBe("there");
    expect(currentCaption(segments, 4.9)).toBe("there");
  });

  it("is empty when there are no lines or the time is outside them", () => {
    expect(currentCaption(undefined, 1)).toBeNull();
    expect(currentCaption([], 1)).toBeNull();
    expect(currentCaption(segments, 5)).toBeNull();
  });
});
