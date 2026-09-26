import { and, isNotNull, ne } from "drizzle-orm";
import { youtubeVideos } from "@/api/db/schema";

// A Video is in the Library once kept, fetched or on its way; a cancelled fetch un-keeps it.
export const isKept = and(
  isNotNull(youtubeVideos.keptAt),
  isNotNull(youtubeVideos.downloadStatus),
  ne(youtubeVideos.downloadStatus, "cancelled")
);
