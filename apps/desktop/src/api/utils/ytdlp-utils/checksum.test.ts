import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  matchesExpected,
  parseChecksumForAsset,
  sha256OfFile,
} from "./checksum";

describe("checksum", () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `checksum-test-${Date.now()}.bin`);
    fs.writeFileSync(tmpFile, "hello");
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  test("sha256OfFile returns the file digest", () => {
    const digest = sha256OfFile(tmpFile);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).toBe(sha256OfFile(tmpFile));
  });

  test("matchesExpected accepts matching digests", () => {
    const digest = sha256OfFile(tmpFile);
    expect(matchesExpected(digest, digest)).toBe(true);
    expect(matchesExpected(digest, `sha256:${digest}`)).toBe(true);
    expect(matchesExpected(digest.toUpperCase(), digest)).toBe(true);
  });

  test("matchesExpected rejects mismatched or invalid digests", () => {
    const digest = sha256OfFile(tmpFile);
    expect(matchesExpected(digest, "a".repeat(64))).toBe(false);
    expect(matchesExpected(digest, "")).toBe(false);
    expect(matchesExpected("", digest)).toBe(false);
    expect(matchesExpected("not-hex", digest)).toBe(false);
  });

  test("parseChecksumForAsset extracts the hash for a named asset", () => {
    const sums = [
      "1111111111111111111111111111111111111111111111111111111111111111  yt-dlp",
      "2222222222222222222222222222222222222222222222222222222222222222  yt-dlp_macos",
      "3333333333333333333333333333333333333333333333333333333333333333  yt-dlp.exe",
    ].join("\n");

    expect(parseChecksumForAsset(sums, "yt-dlp_macos")).toBe(
      "2222222222222222222222222222222222222222222222222222222222222222"
    );
    expect(parseChecksumForAsset(sums, "missing")).toBeNull();
  });
});
