import { t } from "./trpc";
import { utilsRouter } from "@/api/routers/utils";
import { windowRouter } from "@/api/routers/window";
import { ytdlpRouter } from "@/api/routers/ytdlp";
import { queueRouter } from "@/api/routers/queue";
import { preferencesRouter } from "@/api/routers/preferences";
import { translationRouter } from "@/api/routers/translation";
import { annotationsRouter } from "@/api/routers/annotations";
import { watchStatsRouter } from "@/api/routers/watch-stats";
import { transcriptsRouter } from "@/api/routers/transcripts";
import { playlistsRouter } from "@/api/routers/playlists";
import { customPlaylistsRouter } from "@/api/routers/custom-playlists";
import { binaryRouter } from "@/api/routers/binary";
import { aiRouter } from "@/api/routers/ai";
import { flashcardsRouter } from "@/api/routers/flashcards";
import { optimizationRouter } from "@/api/routers/optimization";
import { learningStatsRouter } from "@/api/routers/learning-stats";
import { backgroundJobsRouter } from "@/api/routers/background-jobs";
import { favoritesRouter } from "@/api/routers/favorites";
import { syncRouter } from "@/api/routers/sync";
import { libraryRouter } from "@/api/routers/library";

// Create the root router
export const router = t.router({
  utils: utilsRouter,
  window: windowRouter,
  ytdlp: ytdlpRouter,
  queue: queueRouter,
  preferences: preferencesRouter,
  translation: translationRouter,
  annotations: annotationsRouter,
  watchStats: watchStatsRouter,
  transcripts: transcriptsRouter,
  playlists: playlistsRouter,
  customPlaylists: customPlaylistsRouter,
  binary: binaryRouter,
  ai: aiRouter,
  flashcards: flashcardsRouter,
  optimization: optimizationRouter,
  learningStats: learningStatsRouter,
  backgroundJobs: backgroundJobsRouter,
  favorites: favoritesRouter,
  sync: syncRouter,
  library: libraryRouter,
});

// Export type router type signature
export type AppRouter = typeof router;
