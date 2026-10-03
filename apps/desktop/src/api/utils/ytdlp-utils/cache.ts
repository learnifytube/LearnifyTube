import fs from "fs";
import path from "path";
import { logger } from "@/helpers/logger";
import { getThumbCacheDir } from "./paths";

async function ensureDir(p: string): Promise<void> {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    // Ignore - directory may already exist or parent creation in progress
  }
}

export async function downloadImageToCache(
  url: string,
  filenameBase: string
): Promise<string | null> {
  try {
    // Skip YouTube's placeholder "no thumbnail" image to avoid unnecessary 404s
    if (url.includes("no_thumbnail.jpg") || url.includes("no_thumbnail")) {
      return null;
    }

    await ensureDir(getThumbCacheDir());
    const extMatch = url.match(/\.(jpg|jpeg|png|webp)(?:\?|$)/i);
    const ext = (extMatch?.[1] || "jpg").toLowerCase();
    const filePath = path.join(getThumbCacheDir(), `${filenameBase}.${ext}`);
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn("[thumb] download failed", { url, status: res.status });
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
    return filePath;
  } catch (err) {
    logger.warn("[thumb] download error", { url, error: String(err) });
    return null;
  }
}
