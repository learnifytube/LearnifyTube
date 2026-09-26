import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import { logger } from "@/helpers/logger";
import { app, dialog } from "electron";
import { eq } from "drizzle-orm";
import { userPreferences } from "@/api/db/schema";
import defaultDb, { type Database } from "@/api/db";
import * as path from "path";
import * as fs from "fs";
import type { UserPreferences } from "@/lib/types/user-preferences";
import {
  DEFAULT_USER_PREFERENCES,
  YT_DLP_COOKIE_BROWSERS,
  normalizeDownloadPreferences,
  parseUserPreferences,
} from "@/lib/types/user-preferences";
import { refreshAllowedBaseDirs } from "@/main/security/allowed-dirs";

// Zod schema for preferred languages JSON
const languagesArraySchema = z.array(z.string());

// Return types for preferences router
type UserPreferencesResult = {
  id: string;
  preferredLanguages: string[];
  systemLanguage: string;
  downloadPath: string | null;
  downloadPathBookmark: string | null;
  createdAt: number;
  updatedAt: number | null;
};

type UpdatePreferredLanguagesSuccess = {
  success: true;
  languages: string[];
};

type UpdatePreferredLanguagesFailure = {
  success: false;
  message: string;
};

type UpdatePreferredLanguagesResult =
  | UpdatePreferredLanguagesSuccess
  | UpdatePreferredLanguagesFailure;

type GetSystemLanguageResult = {
  language: string;
};

type GetDownloadPathResult = {
  downloadPath: string;
  isDefault: boolean;
};

type UpdateDownloadPathSuccess = {
  success: true;
  downloadPath: string | null;
};

type UpdateDownloadPathFailure = {
  success: false;
  message: string;
};

type UpdateDownloadPathResult = UpdateDownloadPathSuccess | UpdateDownloadPathFailure;

type EnsureDirectoryAccessSuccess = {
  success: true;
  downloadPath: string;
  updated: boolean;
};

type EnsureDirectoryAccessFailure = {
  success: false;
  message: string;
  cancelled?: boolean;
};

type EnsureDirectoryAccessResult = EnsureDirectoryAccessSuccess | EnsureDirectoryAccessFailure;

const normalizeUserPreferences = (preferences: UserPreferences): UserPreferences => ({
  ...preferences,
  download: normalizeDownloadPreferences(preferences.download),
});

// Get system language from Electron
const getSystemLanguage = (): string => {
  try {
    const locale = app.getLocale(); // e.g., "en-US", "es-ES", "fr-FR"
    // Extract primary language code (first 2 chars)
    const lang = locale.split("-")[0].toLowerCase();
    return lang || "en";
  } catch (e) {
    logger.warn("[preferences] Failed to get system language", { error: String(e) });
    return "en";
  }
};

// Get default download path
const getDefaultDownloadPath = (): string => {
  return path.join(app.getPath("downloads"), "LearnifyTube");
};

const hasReadAccess = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.promises.access(targetPath, fs.constants.R_OK);
    logger.debug("[preferences] Directory is readable", { targetPath });
    return true;
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "UNKNOWN";
    const message = error instanceof Error ? error.message : String(error);

    const isPermissionError = errorCode === "EPERM" || errorCode === "EACCES";
    if (isPermissionError) {
      logger.warn("[preferences] Permission denied when accessing directory", {
        targetPath,
        errorCode,
        message,
      });
      return false;
    }

    if (errorCode === "ENOENT") {
      const parentPath = path.dirname(targetPath);

      if (parentPath !== targetPath) {
        try {
          await fs.promises.access(parentPath, fs.constants.R_OK);
          logger.info(
            "[preferences] Directory does not exist yet, but parent directory is readable",
            {
              targetPath,
              parentPath,
            }
          );
          return true;
        } catch (parentError) {
          const parentErrorCode =
            typeof parentError === "object" && parentError !== null && "code" in parentError
              ? String(parentError.code)
              : "UNKNOWN";

          logger.warn("[preferences] Directory and parent directory are not accessible", {
            targetPath,
            parentPath,
            errorCode,
            message,
            parentErrorCode,
            parentMessage: parentError instanceof Error ? parentError.message : String(parentError),
          });
          return false;
        }
      }

      logger.warn("[preferences] Directory does not exist", {
        targetPath,
        errorCode,
        message,
      });
      return false;
    }

    logger.error("[preferences] Unexpected error when checking directory access", {
      targetPath,
      errorCode,
      message,
    });
    return false;
  }
};

// Initialize user preferences with system language if not exists
const ensurePreferencesExist = async (db: Database): Promise<void> => {
  try {
    const existing = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.id, "default"))
      .limit(1);

    if (existing.length === 0) {
      const systemLang = getSystemLanguage();
      const now = Date.now();
      await db.insert(userPreferences).values({
        id: "default",
        preferredLanguages: JSON.stringify([systemLang]),
        systemLanguage: systemLang,
        createdAt: now,
        updatedAt: now,
      });
      logger.info("[preferences] Initialized with system language", { systemLang });
    } else if (!existing[0].systemLanguage) {
      // Backfill systemLanguage if missing
      const systemLang = getSystemLanguage();
      await db
        .update(userPreferences)
        .set({ systemLanguage: systemLang, updatedAt: Date.now() })
        .where(eq(userPreferences.id, "default"));
      logger.info("[preferences] Backfilled system language", { systemLang });
    }
  } catch (e) {
    logger.error("[preferences] Failed to ensure preferences exist", e);
  }
};

export const preferencesRouter = t.router({
  // Get user preferences (auto-initialize if missing)
  getUserPreferences: publicProcedure.query(async ({ ctx }): Promise<UserPreferencesResult> => {
    const db = ctx.db ?? defaultDb;
    await ensurePreferencesExist(db);

    try {
      const rows = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.id, "default"))
        .limit(1);

      if (rows.length === 0) {
        // Fallback: return default with system language
        const systemLang = getSystemLanguage();
        return {
          id: "default",
          preferredLanguages: [systemLang],
          systemLanguage: systemLang,
          downloadPath: null,
          downloadPathBookmark: null,
          createdAt: Date.now(),
          updatedAt: null,
        } as const;
      }

      const row = rows[0];
      const langsResult = languagesArraySchema.safeParse(
        JSON.parse(row.preferredLanguages || "[]")
      );
      return {
        id: row.id,
        preferredLanguages: langsResult.success ? langsResult.data : [],
        systemLanguage: row.systemLanguage ?? getSystemLanguage(),
        downloadPath: row.downloadPath,
        downloadPathBookmark: row.downloadPathBookmark,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } as const;
    } catch (e) {
      logger.error("[preferences] getUserPreferences failed", e);
      const systemLang = getSystemLanguage();
      return {
        id: "default",
        preferredLanguages: [systemLang],
        systemLanguage: systemLang,
        downloadPath: null,
        downloadPathBookmark: null,
        createdAt: Date.now(),
        updatedAt: null,
      } as const;
    }
  }),

  // Update preferred languages list
  updatePreferredLanguages: publicProcedure
    .input(z.object({ languages: z.array(z.string()).min(1) }))
    .mutation(async ({ input, ctx }): Promise<UpdatePreferredLanguagesResult> => {
      const db = ctx.db ?? defaultDb;
      await ensurePreferencesExist(db);

      try {
        const now = Date.now();
        const json = JSON.stringify(input.languages);
        await db
          .update(userPreferences)
          .set({ preferredLanguages: json, updatedAt: now })
          .where(eq(userPreferences.id, "default"));

        logger.info("[preferences] Updated preferred languages", { languages: input.languages });
        return { success: true as const, languages: input.languages };
      } catch (e) {
        logger.error("[preferences] updatePreferredLanguages failed", e);
        return { success: false as const, message: String(e) };
      }
    }),

  // Get system language (utility)
  getSystemLanguage: publicProcedure.query((): GetSystemLanguageResult => {
    return { language: getSystemLanguage() };
  }),

  // Get download path (returns custom path or default)
  getDownloadPath: publicProcedure.query(async ({ ctx }): Promise<GetDownloadPathResult> => {
    const db = ctx.db ?? defaultDb;
    await ensurePreferencesExist(db);

    try {
      const rows = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.id, "default"))
        .limit(1);

      const customPath = rows.length > 0 ? rows[0].downloadPath : null;
      const downloadPath = customPath || getDefaultDownloadPath();

      return {
        downloadPath,
        isDefault: !customPath,
      };
    } catch (e) {
      logger.error("[preferences] getDownloadPath failed", e);
      return {
        downloadPath: getDefaultDownloadPath(),
        isDefault: true,
      };
    }
  }),

  // Update download path (null = use default)
  updateDownloadPath: publicProcedure
    .input(z.object({ downloadPath: z.string().nullable() }))
    .mutation(async ({ input, ctx }): Promise<UpdateDownloadPathResult> => {
      const db = ctx.db ?? defaultDb;
      await ensurePreferencesExist(db);

      try {
        const now = Date.now();
        await db
          .update(userPreferences)
          .set({ downloadPath: input.downloadPath, updatedAt: now })
          .where(eq(userPreferences.id, "default"));

        logger.info("[preferences] Updated download path", { downloadPath: input.downloadPath });
        // Keep the file-serving allowlist in sync with the new download dir.
        await refreshAllowedBaseDirs();
        return { success: true as const, downloadPath: input.downloadPath };
      } catch (e) {
        logger.error("[preferences] updateDownloadPath failed", e);
        return { success: false as const, message: String(e) };
      }
    }),

  ensureDownloadDirectoryAccess: publicProcedure
    .input(
      z.object({
        filePath: z.string().optional(),
        directoryPath: z.string().optional(),
        forcePrompt: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }): Promise<EnsureDirectoryAccessResult> => {
      const db = ctx.db ?? defaultDb;
      await ensurePreferencesExist(db);

      try {
        const rows = await db
          .select()
          .from(userPreferences)
          .where(eq(userPreferences.id, "default"))
          .limit(1);

        const storedPath = rows.length > 0 ? rows[0].downloadPath : null;
        const fallbackPath = storedPath ?? getDefaultDownloadPath();
        const candidateDir =
          input.directoryPath ?? (input.filePath ? path.dirname(input.filePath) : fallbackPath);
        const resolvedTarget = path.resolve(candidateDir);
        const forcePrompt = input.forcePrompt === true;

        logger.info("[preferences] ensureDownloadDirectoryAccess invoked", {
          requestedFilePath: input.filePath,
          requestedDirectoryPath: input.directoryPath,
          storedPath,
          fallbackPath,
          candidateDir,
          resolvedTarget,
          forcePrompt,
        });

        if (!forcePrompt && (await hasReadAccess(resolvedTarget))) {
          logger.info("[preferences] Directory already accessible", { resolvedTarget });
          return { success: true, downloadPath: resolvedTarget, updated: false };
        }

        if (forcePrompt) {
          logger.info("[preferences] Forcing user prompt for directory access", { resolvedTarget });
        } else {
          logger.warn("[preferences] Directory not accessible, prompting user", { resolvedTarget });
        }

        const selection = await dialog.showOpenDialog({
          title: "Allow LearnifyTube to access this folder",
          message:
            "macOS blocked access to this folder. Please select the Downloads folder (or another folder) to grant permission.",
          properties: ["openDirectory", "createDirectory"],
          defaultPath: resolvedTarget,
          securityScopedBookmarks: true,
        });

        if (selection.canceled || selection.filePaths.length === 0) {
          logger.warn("[preferences] Folder selection dialog cancelled", {
            resolvedTarget,
            selection,
          });
          return {
            success: false,
            cancelled: true,
            message: "Folder selection was cancelled",
          };
        }

        const selectedPath = selection.filePaths[0];
        const bookmark = selection.bookmarks ? selection.bookmarks[0] : null;

        logger.info("[preferences] User granted directory", {
          selectedPath,
          hasBookmark: !!bookmark,
          previousPath: storedPath,
        });
        await db
          .update(userPreferences)
          .set({
            downloadPath: selectedPath,
            downloadPathBookmark: bookmark,
            updatedAt: Date.now(),
          })
          .where(eq(userPreferences.id, "default"))
          .execute();

        logger.info("[preferences] Stored new download directory", {
          selectedPath,
          updatedFromStored: selectedPath !== storedPath,
        });

        // Keep the file-serving allowlist in sync with the new download dir.
        await refreshAllowedBaseDirs();

        return {
          success: true,
          downloadPath: selectedPath,
          updated: selectedPath !== storedPath,
        };
      } catch (e) {
        logger.error("[preferences] ensureDownloadDirectoryAccess failed", e);
        return {
          success: false,
          message: String(e),
        };
      }
    }),

  // Get customization preferences
  getCustomizationPreferences: publicProcedure.query(async ({ ctx }): Promise<UserPreferences> => {
    const db = ctx.db ?? defaultDb;
    await ensurePreferencesExist(db);

    try {
      const rows = await db
        .select()
        .from(userPreferences)
        .where(eq(userPreferences.id, "default"))
        .limit(1);

      if (rows.length === 0 || !rows[0].customizationSettings) {
        return DEFAULT_USER_PREFERENCES;
      }

      const stored: unknown = JSON.parse(rows[0].customizationSettings);
      const preferences = parseUserPreferences(stored);

      // Merge with defaults to ensure all fields exist
      return normalizeUserPreferences({
        ...DEFAULT_USER_PREFERENCES,
        ...preferences,
        sidebar: { ...DEFAULT_USER_PREFERENCES.sidebar, ...preferences.sidebar },
        appearance: { ...DEFAULT_USER_PREFERENCES.appearance, ...preferences.appearance },
        player: { ...DEFAULT_USER_PREFERENCES.player, ...preferences.player },
        learning: { ...DEFAULT_USER_PREFERENCES.learning, ...preferences.learning },
        download: { ...DEFAULT_USER_PREFERENCES.download, ...preferences.download },
        sync: { ...DEFAULT_USER_PREFERENCES.sync, ...preferences.sync },
      });
    } catch (error) {
      logger.error("[preferences] Error loading customization preferences", { error });
      return DEFAULT_USER_PREFERENCES;
    }
  }),

  // Update customization preferences
  updateCustomizationPreferences: publicProcedure
    .input(
      z.object({
        sidebar: z
          .object({
            visibleItems: z
              .array(
                z.enum([
                  "home",
                  "dashboard",
                  "channels",
                  "playlists",
                  "library",
                  "my-playlists",
                  "subscriptions",
                  "history",
                  "my-words",
                  "flashcards",
                  "analytics",
                  "storage",
                  "mobile-sync",
                  "logs",
                  "settings",
                ])
              )
              .optional(),
            collapsed: z.boolean().optional(),
          })
          .optional(),
        appearance: z
          .object({
            themeMode: z.enum(["light", "dark"]).optional(),
            fontScale: z.enum(["small", "normal", "large", "x-large"]).optional(),
            fontFamily: z.enum(["default", "sans", "mono", "dyslexic"]).optional(),
            uiSize: z.enum(["compact", "comfortable", "spacious"]).optional(),
            showAnimations: z.enum(["none", "reduced", "normal", "enhanced"]).optional(),
            reducedMotion: z.boolean().optional(),
            showIcons: z.boolean().optional(),
            roundedCorners: z.boolean().optional(),
          })
          .optional(),
        player: z
          .object({
            autoPlay: z.boolean().optional(),
            defaultSpeed: z.number().min(0.25).max(2).optional(),
            defaultVolume: z.number().min(0).max(100).optional(),
            showSubtitles: z.boolean().optional(),
            subtitleLanguage: z.string().optional(),
          })
          .optional(),
        learning: z
          .object({
            pauseOnNewWord: z.boolean().optional(),
            highlightTranslations: z.boolean().optional(),
            autoSaveWords: z.boolean().optional(),
          })
          .optional(),
        download: z
          .object({
            downloadQuality: z.enum(["360p", "480p", "720p", "1080p"]).optional(),
            cookiesFromBrowser: z.enum(YT_DLP_COOKIE_BROWSERS).optional(),
          })
          .optional(),
        sync: z
          .object({
            enabled: z.boolean().optional(),
            port: z.number().min(1024).max(65535).optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }): Promise<UserPreferences> => {
      const db = ctx.db ?? defaultDb;
      await ensurePreferencesExist(db);

      try {
        // Get current preferences from database
        const rows = await db
          .select()
          .from(userPreferences)
          .where(eq(userPreferences.id, "default"))
          .limit(1);

        const storedSettings = rows[0]?.customizationSettings;
        const current = (() => {
          if (!storedSettings) {
            return DEFAULT_USER_PREFERENCES;
          }
          const parsed: unknown = JSON.parse(storedSettings);
          return parseUserPreferences(parsed);
        })();

        const updated = normalizeUserPreferences({
          ...current,
          ...input,
          sidebar: { ...current.sidebar, ...input.sidebar },
          appearance: { ...current.appearance, ...input.appearance },
          player: { ...current.player, ...input.player },
          learning: { ...current.learning, ...input.learning },
          download: { ...current.download, ...input.download },
          sync: { ...current.sync, ...input.sync },
          lastUpdated: Date.now(),
          version: 1,
        });

        // Save to database
        await db
          .update(userPreferences)
          .set({
            customizationSettings: JSON.stringify(updated),
            updatedAt: Date.now(),
          })
          .where(eq(userPreferences.id, "default"));

        logger.info("[preferences] Customization preferences updated", { updates: input });

        return updated;
      } catch (error) {
        logger.error("[preferences] Error updating customization preferences", { error, input });
        throw error;
      }
    }),

  // Reset customization preferences
  resetCustomizationPreferences: publicProcedure.mutation(
    async ({ ctx }): Promise<UserPreferences> => {
      const db = ctx.db ?? defaultDb;
      await ensurePreferencesExist(db);

      try {
        await db
          .update(userPreferences)
          .set({
            customizationSettings: JSON.stringify(DEFAULT_USER_PREFERENCES),
            updatedAt: Date.now(),
          })
          .where(eq(userPreferences.id, "default"));

        logger.info("[preferences] Customization preferences reset to defaults");
        return DEFAULT_USER_PREFERENCES;
      } catch (error) {
        logger.error("[preferences] Error resetting customization preferences", { error });
        throw error;
      }
    }
  ),
});

// Router type not exported (unused)
