import { parseByteRange } from "./byte-range";

describe("parseByteRange", () => {
  test("reads a start and end", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
  });

  test("runs an open range to the end of the file", () => {
    expect(parseByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  test("reads a suffix range as the last bytes of the file", () => {
    expect(parseByteRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
  });

  test("clamps an end past the file to its last byte", () => {
    expect(parseByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  test("refuses a range that starts past the file", () => {
    expect(parseByteRange("bytes=1000-", 1000)).toBeNull();
  });

  test("refuses a malformed range", () => {
    expect(parseByteRange("bytes=-", 1000)).toBeNull();
    expect(parseByteRange("bytes=abc-", 1000)).toBeNull();
    expect(parseByteRange("bytes=50-10", 1000)).toBeNull();
  });
});
