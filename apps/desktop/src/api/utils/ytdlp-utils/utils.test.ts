import { getDirectLatestDownloadUrl, getDirectPinnedDownloadUrl, getYtDlpAssetName } from "./ytdlp-utils";

describe("ytdlp utils", () => {
  test("asset name by platform", () => {
    expect(getYtDlpAssetName("win32")).toBe("yt-dlp.exe");
    expect(getYtDlpAssetName("darwin")).toBe("yt-dlp_macos");
    expect(getYtDlpAssetName("linux")).toBe("yt-dlp");
  });

  test("direct latest download url", () => {
    expect(getDirectLatestDownloadUrl("win32")).toContain("/yt-dlp.exe");
    expect(getDirectLatestDownloadUrl("darwin")).toContain("/yt-dlp_macos");
    expect(getDirectLatestDownloadUrl("linux")).toContain("/yt-dlp");
  });

  test("pinned download url uses the pinned tag", () => {
    expect(getDirectPinnedDownloadUrl("darwin")).toContain("/2026.06.09/yt-dlp_macos");
  });
});
