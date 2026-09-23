type SupportedPlatform = NodeJS.Platform; // 'darwin' | 'win32' | 'linux' | ...

/** Pinned yt-dlp release — bump deliberately after testing a newer build. */
export const YT_DLP_PINNED_VERSION = "2026.06.09";

// Return the expected asset filename for the given platform as published by yt-dlp
export const getYtDlpAssetName = (platform: SupportedPlatform): string => {
  switch (platform) {
    case "win32":
      return "yt-dlp.exe";
    case "darwin":
      return "yt-dlp_macos"; // official macOS build name
    case "linux":
    default:
      return "yt-dlp"; // linux and others
  }
};

export const getLatestReleaseApiUrl = (): string =>
  "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

export const getPinnedReleaseApiUrl = (): string =>
  `https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/${YT_DLP_PINNED_VERSION}`;

export const getDirectLatestDownloadUrl = (platform: SupportedPlatform): string =>
  `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${getYtDlpAssetName(platform)}`;

export const getDirectPinnedDownloadUrl = (platform: SupportedPlatform): string =>
  `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_PINNED_VERSION}/${getYtDlpAssetName(platform)}`;

export const getPinnedChecksumsUrl = (): string =>
  `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_PINNED_VERSION}/SHA2-256SUMS`;
