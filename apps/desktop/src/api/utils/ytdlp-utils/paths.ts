import path from "node:path";
import { app } from "electron";
import { getYtDlpAssetName } from "./ytdlp-utils";

export const getThumbCacheDir = (): string =>
  path.join(app.getPath("userData"), "cache", "thumbnails");

export const getYtDlpBinaryPath = (): string =>
  path.join(app.getPath("userData"), "bin", getYtDlpAssetName(process.platform));
