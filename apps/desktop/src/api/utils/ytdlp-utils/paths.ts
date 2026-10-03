import path from "node:path";
import { app } from "electron";
import { getYtDlpAssetName } from "./ytdlp-utils";
import { thumbnailsDir } from "./thumbnails-dir";

export { thumbnailsDir };

export const getThumbCacheDir = (): string =>
  thumbnailsDir(app.getPath("userData"));

export const getYtDlpBinaryPath = (): string =>
  path.join(app.getPath("userData"), "bin", getYtDlpAssetName(process.platform));
