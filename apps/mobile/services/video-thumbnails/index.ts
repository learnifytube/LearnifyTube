import { Directory, File, Paths } from "expo-file-system";
import { getHeldInlineThumbnails } from "../../db/repositories/videos";
import { api } from "../api";
import { resolveRemoteAssetUrl } from "../browseCache";
import { fetchThumbnail } from "../thumbnailCache";
import {
  createVideoThumbnails,
  type VideoThumbnailsPlatform,
} from "./createVideoThumbnails";

const thumbnailsDir = () => new Directory(Paths.document, "thumbnails");

const platform: VideoThumbnailsPlatform = {
  list: () => {
    const dir = thumbnailsDir();
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((entry) => entry instanceof File)
      .map((file) => ({ name: file.name, uri: file.uri }));
  },
  fetch: fetchThumbnail,
  write: (name, bytes) => {
    const dir = thumbnailsDir();
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, name);
    file.create({ overwrite: true });
    file.write(bytes);
    return file.uri;
  },
  delete: (uri) => {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  desktopThumbnailUrl: api.getThumbnailUrl,
  resolveUrl: resolveRemoteAssetUrl,
};

export const videoThumbnails = createVideoThumbnails(platform);

/**
 * Stores each held Video's inline thumbnail as a file, unless it has one, so
 * it still shows in Offline mode once SQLite drops inline thumbnails.
 */
export async function storeHeldInlineThumbnails() {
  for (const { id, thumbnailUrl } of await getHeldInlineThumbnails()) {
    if (videoThumbnails.getUri(id)) continue;
    await videoThumbnails.store("", id, thumbnailUrl).catch((error) => {
      console.warn("[VideoThumbnails] Failed to store inline thumbnail", error);
    });
  }
}
export type { VideoThumbnails } from "./createVideoThumbnails";
