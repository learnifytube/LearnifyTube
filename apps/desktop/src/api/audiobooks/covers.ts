import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { CoverSource } from "./import-plan";
import { extractEmbeddedArt } from "./scan-folder";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

// Writes the cover to `<coversDir>/<bookId>.<ext>`; null for the placeholder.
export const saveCover = async (
  folderPath: string,
  cover: CoverSource,
  coversDir: string,
  bookId: string
): Promise<string | null> => {
  await fs.promises.mkdir(coversDir, { recursive: true });
  if (cover.kind === "file") {
    const source = path.join(folderPath, cover.path);
    const target = path.join(coversDir, `${bookId}${path.extname(source).toLowerCase()}`);
    await fs.promises.copyFile(source, target);
    return target;
  }
  if (cover.kind === "embedded") {
    const target = path.join(coversDir, `${bookId}.jpg`);
    const ok = await extractEmbeddedArt(path.join(folderPath, cover.trackPath), target);
    return ok ? target : null;
  }
  return null;
};

// Copies an image the user picked to `<coversDir>/<bookId>-<time>.<ext>`; a new
// name each time so the renderer doesn't show the old cover from cache.
export const saveCoverFromImage = async (
  imagePath: string,
  coversDir: string,
  bookId: string
): Promise<string> => {
  await fs.promises.mkdir(coversDir, { recursive: true });
  const target = path.join(
    coversDir,
    `${bookId}-${Date.now()}${path.extname(imagePath).toLowerCase()}`
  );
  await fs.promises.copyFile(imagePath, target);
  return target;
};

// Deletes an app-owned cover copy. Anything outside the covers folder is the
// user's and is never touched.
export const removeAppCover = async (
  coverPath: string | null,
  coversDir: string
): Promise<void> => {
  if (!coverPath || path.dirname(path.resolve(coverPath)) !== path.resolve(coversDir)) return;
  await fs.promises.rm(coverPath, { force: true }).catch(() => undefined);
};

export const COVER_IMAGE_EXTENSIONS = Object.keys(MIME_BY_EXTENSION).map((ext) => ext.slice(1));

// A data URL for showing the cover in the Import preview, before anything is saved.
export const previewCover = async (
  folderPath: string,
  cover: CoverSource
): Promise<string | null> => {
  try {
    if (cover.kind === "file") {
      const source = path.join(folderPath, cover.path);
      const mime = MIME_BY_EXTENSION[path.extname(source).toLowerCase()] ?? "image/jpeg";
      const bytes = await fs.promises.readFile(source);
      return `data:${mime};base64,${bytes.toString("base64")}`;
    }
    if (cover.kind === "embedded") {
      const tmp = path.join(os.tmpdir(), `learnifytube-cover-${randomUUID()}.jpg`);
      const ok = await extractEmbeddedArt(path.join(folderPath, cover.trackPath), tmp);
      if (!ok) return null;
      const bytes = await fs.promises.readFile(tmp);
      await fs.promises.rm(tmp, { force: true });
      return `data:image/jpeg;base64,${bytes.toString("base64")}`;
    }
  } catch {
    // A cover that can't be read falls back to the placeholder.
  }
  return null;
};
