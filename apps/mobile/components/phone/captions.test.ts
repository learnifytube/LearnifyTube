import { currentCaption } from "./captions";
import type { TranscriptSegment } from "../../types";

const segments: TranscriptSegment[] = [
  { start: 0, end: 2, text: "Hello" },
  { start: 2, end: 5, text: "there" },
  { start: 10, end: 14, text: "one two three four five six seven eight" },
];

describe("currentCaption", () => {
  it("returns the line covering the playback time", () => {
    expect(currentCaption(segments, 0)).toBe("Hello");
    expect(currentCaption(segments, 1.9)).toBe("Hello");
    expect(currentCaption(segments, 2)).toBe("there");
    expect(currentCaption(segments, 4.9)).toBe("there");
  });

  it("keeps a line up through a short gap, then clears it", () => {
    expect(currentCaption(segments, 5.5)).toBe("there");
    expect(currentCaption(segments, 6)).toBeNull();
  });

  it("is empty when there are no lines or the time is outside them", () => {
    expect(currentCaption(undefined, 1)).toBeNull();
    expect(currentCaption([], 1)).toBeNull();
    expect(currentCaption(segments, 8)).toBeNull();
  });

  it("splits a long line into even chunks shown in turn", () => {
    expect(currentCaption(segments, 10, 24)).toBe("one two three four");
    expect(currentCaption(segments, 13.9, 24)).toBe("five six seven eight");
    expect(currentCaption(segments, 14.5, 24)).toBe("five six seven eight");
  });

  it("shows a line that fits whole, with spacing tidied", () => {
    expect(
      currentCaption([{ start: 0, end: 1, text: " a\n  b " }], 0.5, 24),
    ).toBe("a b");
  });
});
