import { getDirectPinnedDownloadUrl, getYtDlpAssetName } from "./ytdlp-utils";

describe("ytdlp utils", () => {
  test("asset name by platform", () => {
    expect(getYtDlpAssetName("win32")).toBe("yt-dlp.exe");
    expect(getYtDlpAssetName("darwin")).toBe("yt-dlp_macos");
    expect(getYtDlpAssetName("linux")).toBe("yt-dlp");
  });

  test("pinned download url uses the pinned tag", () => {
    expect(getDirectPinnedDownloadUrl("darwin")).toContain("/2026.06.09/yt-dlp_macos");
    expect(getDirectPinnedDownloadUrl("win32")).toContain("/2026.06.09/yt-dlp.exe");
    expect(getDirectPinnedDownloadUrl("linux")).not.toContain("/latest/");
  });
});
