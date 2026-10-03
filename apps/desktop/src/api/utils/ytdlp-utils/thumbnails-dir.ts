import path from "node:path";

/** Not `cache/`: on macOS that is Chromium's Cache folder (case-insensitive). */
export function thumbnailsDir(userData: string): string {
  return path.join(userData, "thumbnails");
}
