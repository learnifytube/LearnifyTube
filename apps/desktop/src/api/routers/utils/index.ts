import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import { shell, net, app, dialog } from "electron";
import { sql } from "drizzle-orm";
import {
  createNotificationWindow,
  closeNotificationWindow as closeWindow,
} from "@/main/windows/notification";
import { sendNotificationToWindow } from "@/helpers/notification/notification-window-utils";

import { logger } from "@/helpers/logger";
import path from "path";
import fs from "fs";
import os from "os";
import { extractZipWithYauzl } from "./service";
import defaultDb from "@/api/db";
import {
  clearConfiguredDatabaseFilePath,
  getActiveDatabaseFilePath,
  getDatabasePath,
  getDefaultDatabaseFilePath,
  isUsingDefaultDatabasePath,
  setConfiguredDatabaseFilePath,
} from "@/utils/paths";
import { translationCache, translationContexts } from "@/api/db/schema";
import crypto from "crypto";
import { buildAppLinks } from "@/config/app-links";

// Zod schemas for dictionary API response
const dictionaryDefinitionSchema = z.object({
  definition: z.string(),
  example: z.string().optional(),
});

const dictionaryMeaningSchema = z.object({
  partOfSpeech: z.string().optional(),
  definitions: z.array(dictionaryDefinitionSchema).optional(),
});

const dictionaryPhoneticSchema = z.object({
  text: z.string().optional(),
});

const dictionaryEntrySchema = z.object({
  meanings: z.array(dictionaryMeaningSchema).optional(),
  phonetic: z.string().optional(),
  phonetics: z.array(dictionaryPhoneticSchema).optional(),
});

const dictionaryResponseSchema = z.union([z.array(dictionaryEntrySchema), dictionaryEntrySchema]);

// Zod schema for Google Translate API response
// Actual response: [[["nhiễm trùng","infections",null,null,3,null,null,[[]],[[...]]]],null,"en",null,null,null,1,[],[...]]
// Structure:
// [0] translations: [["translated", "original", null, null, wordCount, null, null, [[]], metadata], ...]
// [1] null
// [2] detectedLanguage: "en"
// [3-5] null
// [6] confidence: 1
// [7] []
// [8] language metadata
// Note: Currently not used for validation, kept for documentation and potential future use
const _googleTranslateResponseSchema = z.tuple([
  z.array(z.array(z.unknown())), // translations - flexible to handle varying array lengths
  z.null(), // unused
  z.string(), // detected language (required)
  z.null().optional(),
  z.null().optional(),
  z.null().optional(),
  z.number().optional(), // confidence score
  z.array(z.unknown()).optional(),
  z.array(z.unknown()).optional(), // language metadata
]);

// Return types for utils router endpoints
type OpenExternalUrlResult = {
  success: boolean;
};

type ExplainWordSuccess = {
  success: true;
  word: string;
  explanation: string;
  pronunciation: string;
};

type ExplainWordFallback = {
  success: false;
  shouldOpenChatGPT: true;
  word: string;
  language: string;
};

type ExplainWordFailure = {
  success: false;
  message: string;
};

type ExplainWordResult = ExplainWordSuccess | ExplainWordFallback | ExplainWordFailure;

type TranslateTextSuccess = {
  success: true;
  translation: string; // The translated text
  translationId: string; // ID for saving to My Words
  originalText: string;
  sourceLang: string;
  targetLang: string;
  fromCache: boolean;
  queryCount?: number;
};

type TranslateTextFailure = {
  success: false;
  message: string;
};

type TranslateTextResult = TranslateTextSuccess | TranslateTextFailure;

type OpenLocalFileSuccess = { success: true };
type OpenLocalFileFailure = { success: false; error: string };
type OpenLocalFileResult = OpenLocalFileSuccess | OpenLocalFileFailure;

type OpenFolderSuccess = { success: true };
type OpenFolderFailure = { success: false; error: string };
type OpenFolderResult = OpenFolderSuccess | OpenFolderFailure;

type SelectFolderSuccess = { success: true; folderPath: string };
type SelectFolderCancelled = { success: false; cancelled: true };
type SelectFolderFailure = { success: false; cancelled: false; error: string };
type SelectFolderResult = SelectFolderSuccess | SelectFolderCancelled | SelectFolderFailure;

type SelectDatabaseFileSuccess = { success: true; filePath: string };
type SelectDatabaseFileCancelled = { success: false; cancelled: true };
type SelectDatabaseFileFailure = { success: false; cancelled: false; error: string };
type SelectDatabaseFileResult =
  | SelectDatabaseFileSuccess
  | SelectDatabaseFileCancelled
  | SelectDatabaseFileFailure;

type UpdateDatabasePathSuccess = {
  success: true;
  path: string;
  copiedExistingData: boolean;
  usedExistingDatabase: boolean;
  isDefault: boolean;
  requiresRestart: boolean;
};
type UpdateDatabasePathFailure = { success: false; error: string };
type UpdateDatabasePathResult = UpdateDatabasePathSuccess | UpdateDatabasePathFailure;

type QuitAppSuccess = { success: true };
type QuitAppFailure = { success: false; error: string };
type QuitAppResult = QuitAppSuccess | QuitAppFailure;

type RestartAppSuccess = { success: true };
type RestartAppFailure = { success: false; error: string };
type RestartAppResult = RestartAppSuccess | RestartAppFailure;

type GetAppVersionResult = { version: string };
type GetLogFileContentResult = {
  content: string;
  path: string | null;
  exists: boolean;
};
type ClearLogFileSuccess = { success: true };
type ClearLogFileFailure = { success: false; error: string };
type ClearLogFileResult = ClearLogFileSuccess | ClearLogFileFailure;

type DownloadUpdateSuccess = {
  status: "success";
  message: string;
  filePath: string;
  filename: string;
};

type DownloadUpdateFailure = {
  status: "error";
  message: string;
};

type DownloadUpdateResult = DownloadUpdateSuccess | DownloadUpdateFailure;

type CheckForUpdatesSuccess = {
  updateAvailable: true;
  latestVersion: string;
  currentVersion: string;
  downloadUrl: string;
  releaseNotes: string;
};

type CheckForUpdatesNoUpdate = {
  updateAvailable: false;
  latestVersion: string;
  currentVersion: string;
};

type CheckForUpdatesResult = CheckForUpdatesSuccess | CheckForUpdatesNoUpdate;

type SendNotificationSuccess = { success: true } | { success: boolean };
type SendNotificationFailure = { success: false; error: string };
type SendNotificationResult = SendNotificationSuccess | SendNotificationFailure;

type CloseNotificationWindowSuccess = { success: true };
type CloseNotificationWindowFailure = { success: false; error: string };
type CloseNotificationWindowResult =
  | CloseNotificationWindowSuccess
  | CloseNotificationWindowFailure;

type InstallUpdateSuccess = {
  status: "success";
  message: string;
  fallbackUrl: null;
  downloadUrl: null;
};

type InstallUpdateFailure = {
  status: "error";
  message: string;
};

type InstallUpdateResult = InstallUpdateSuccess | InstallUpdateFailure;

type GetDatabasePathResult = {
  path: string;
  directory: string;
  exists: boolean;
  size: number;
  defaultPath: string;
  isDefault: boolean;
};

// Desktop and mobile publish to the same repo, so `/releases/latest` can be a
// `mobile-v*` release. Scan the list and take the newest desktop `v*` tag.
const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/learnifytube/LearnifyTube/releases?per_page=30";
const DESKTOP_RELEASE_TAG = /^v\d/i;

type GitHubRelease = {
  tag_name?: string;
  body?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeVersion = (version: string): string => version.replace(/^v/i, "");

const SQLITE_DATABASE_ARTIFACT_SUFFIXES = ["", "-shm", "-wal", "-journal"] as const;

type DatabaseArtifactBackup = {
  originalPath: string;
  backupPath: string;
};

const compareVersions = (a: string, b: string): number => {
  const aParts = normalizeVersion(a)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const bParts = normalizeVersion(b)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLength; i += 1) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
};

const escapeSqliteString = (value: string): string => value.replace(/'/g, "''");

const moveExistingDatabaseArtifactsOutOfTheWay = (targetPath: string): DatabaseArtifactBackup[] => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backups: DatabaseArtifactBackup[] = [];

  for (const suffix of SQLITE_DATABASE_ARTIFACT_SUFFIXES) {
    const originalPath = `${targetPath}${suffix}`;
    if (!fs.existsSync(originalPath)) {
      continue;
    }

    const backupPath = `${originalPath}.${timestamp}.before-db-path-change`;
    fs.renameSync(originalPath, backupPath);
    backups.push({ originalPath, backupPath });
  }

  return backups;
};

const restoreDatabaseArtifactBackups = (backups: DatabaseArtifactBackup[]): void => {
  for (const backup of [...backups].reverse()) {
    if (fs.existsSync(backup.backupPath) && !fs.existsSync(backup.originalPath)) {
      fs.renameSync(backup.backupPath, backup.originalPath);
    }
  }
};

const copyActiveDatabaseToPath = async (targetPath: string): Promise<boolean> => {
  const sourcePath = getActiveDatabaseFilePath();

  if (sourcePath === targetPath || !fs.existsSync(sourcePath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const backups = moveExistingDatabaseArtifactsOutOfTheWay(targetPath);

  try {
    await defaultDb.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
    await defaultDb.run(sql.raw(`VACUUM INTO '${escapeSqliteString(targetPath)}'`));
    return true;
  } catch (error) {
    restoreDatabaseArtifactBackups(backups);
    throw error;
  }
};

const getPlatformDownloadUrl = (version: string): string => {
  const links = buildAppLinks(version);

  switch (process.platform) {
    case "win32":
      return links.windows;
    case "darwin":
      // Use DMG for macOS - provides proper drag-to-Applications installation experience
      return process.arch === "arm64" ? links.macos : links.macosIntel;
    case "linux":
      return links.linux;
    default:
      return links.releases;
  }
};

export const utilsRouter = t.router({
  openExternalUrl: publicProcedure
    .input(
      z.object({
        url: z.string().url(),
      })
    )
    .mutation(async ({ input }): Promise<OpenExternalUrlResult> => {
      await shell.openExternal(input.url);
      return { success: true };
    }),

  // Get AI explanation for a word (fun and easy to remember)
  explainWord: publicProcedure
    .input(
      z.object({
        word: z.string().min(1),
        language: z.string().optional(),
      })
    )
    .query(async ({ input }): Promise<ExplainWordResult> => {
      try {
        // Extract the first word and clean it
        const cleanWord = input.word
          .split(/\s+/)[0]
          .replace(/[.,!?;:()[\]'"\-–—]/g, "")
          .toLowerCase();
        const langCode = input.language ? input.language.split("-")[0] : "en";

        // For now, use a simple approach: call a free dictionary API and enhance with a fun explanation
        // You can replace this with OpenAI/Anthropic API later
        const dictionaryApiUrl = `https://api.dictionaryapi.dev/api/v2/entries/${langCode}/${encodeURIComponent(cleanWord)}`;

        try {
          const response = await fetch(dictionaryApiUrl);
          if (response.ok) {
            const rawData: unknown = await response.json();
            const parseResult = dictionaryResponseSchema.safeParse(rawData);

            if (parseResult.success) {
              const data = parseResult.data;
              const firstEntry = Array.isArray(data) ? data[0] : data;

              // Extract definition and example
              const meanings = firstEntry.meanings ?? [];
              const firstMeaning = meanings[0];
              const definition = firstMeaning?.definitions?.[0]?.definition ?? "";
              const example = firstMeaning?.definitions?.[0]?.example ?? "";
              const partOfSpeech = firstMeaning?.partOfSpeech ?? "";

              // Create a fun, memorable explanation with engaging formatting
              let funExplanation = `📚 **${cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1)}**`;

              if (partOfSpeech) {
                funExplanation += ` (${partOfSpeech})`;
              }

              funExplanation += `\n\n${definition || `A word you're learning in ${langCode.toUpperCase()}!`}`;

              if (example) {
                funExplanation += `\n\n✨ *Example: "${example}"*`;
              }

              funExplanation += `\n\n💡 *Memory tip: Try using this word in a sentence right now - practice makes perfect! 💪*`;

              return {
                success: true as const,
                word: cleanWord,
                explanation: funExplanation,
                pronunciation: firstEntry.phonetic ?? firstEntry.phonetics?.[0]?.text ?? "",
              };
            }
          }
        } catch (e) {
          logger.debug("[word-explanation] Dictionary API failed, will open ChatGPT", {
            word: cleanWord,
            error: String(e),
          });
        }

        // Fallback: Return flag to open ChatGPT with word query
        return {
          success: false as const,
          shouldOpenChatGPT: true as const,
          word: cleanWord,
          language: langCode,
        };
      } catch (e) {
        logger.error("[word-explanation] Failed to explain word", {
          word: input.word,
          error: String(e),
        });
        return {
          success: false as const,
          message: "Failed to get word explanation",
        };
      }
    }),

  // Translate text using Google Translate with database caching
  translateText: publicProcedure
    .input(
      z.object({
        text: z.string().min(1),
        targetLang: z.string().default("en"), // Default to English
        sourceLang: z.string().optional(), // Auto-detect if not provided
        // Required video context for linking translation to specific moment
        videoId: z.string().min(1),
        timestampSeconds: z.number(),
        contextText: z.string().optional(), // Context text can be optional
      })
    )
    .query(async ({ input, ctx }): Promise<TranslateTextResult> => {
      try {
        const { text, targetLang, sourceLang } = input;
        const db = ctx.db;

        // Clean the text
        const cleanText = text.trim();
        const sl = sourceLang || "auto"; // auto-detect source language
        const tl = targetLang;

        // Check cache first
        if (db) {
          try {
            const { eq, and } = await import("drizzle-orm");

            const cached = await db
              .select()
              .from(translationCache)
              .where(
                and(
                  eq(translationCache.sourceText, cleanText),
                  eq(translationCache.sourceLang, sl),
                  eq(translationCache.targetLang, tl)
                )
              )
              .limit(1);

            if (cached.length > 0) {
              const cachedEntry = cached[0];

              logger.debug("[translation] Cache hit", {
                sourceText: cleanText,
                sourceLang: sl,
                targetLang: tl,
                queryCount: cachedEntry.queryCount,
              });

              // Update query tracking: increment count and update timestamp
              try {
                const now = Date.now();
                await db
                  .update(translationCache)
                  .set({
                    queryCount: (cachedEntry.queryCount || 0) + 1,
                    lastQueriedAt: now,
                    updatedAt: now,
                  })
                  .where(eq(translationCache.id, cachedEntry.id));

                logger.debug("[translation] Updated query count", {
                  id: cachedEntry.id,
                  newCount: (cachedEntry.queryCount || 0) + 1,
                });
              } catch (updateError) {
                logger.warn("[translation] Failed to update query count", {
                  error: String(updateError),
                });
                // Don't fail the translation if update fails
              }

              // Save video context
              try {
                const now = Date.now();

                await db
                  .insert(translationContexts)
                  .values({
                    id: crypto.randomUUID(),
                    translationId: cachedEntry.id,
                    videoId: input.videoId,
                    timestampSeconds: Math.floor(input.timestampSeconds),
                    contextText: input.contextText || null,
                    createdAt: now,
                  })
                  .onConflictDoNothing(); // Ignore if duplicate

                logger.debug("[translation] Saved video context", {
                  translationId: cachedEntry.id,
                  videoId: input.videoId,
                  timestamp: input.timestampSeconds,
                });
              } catch (contextError) {
                logger.warn("[translation] Failed to save video context", {
                  error: String(contextError),
                });
              }

              return {
                success: true as const,
                translation: cachedEntry.translatedText,
                translationId: cachedEntry.id, // Include translation ID for saving to My Words
                originalText: cleanText,
                sourceLang: cachedEntry.detectedLang || sl,
                targetLang: tl,
                fromCache: true,
                queryCount: (cachedEntry.queryCount || 0) + 1,
              };
            }
          } catch (cacheError) {
            logger.warn("[translation] Cache lookup failed", {
              error: String(cacheError),
            });
            // Continue to API call if cache fails
          }
        }

        // Use Google Translate's free endpoint
        // Format: https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=hello
        const encodedText = encodeURIComponent(cleanText);
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodedText}`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Translation API returned ${response.status}`);
        }

        const rawData: unknown = await response.json();

        // Log actual response for debugging
        logger.info("[translation] Google Translate API response received", {
          structure: JSON.stringify(rawData).substring(0, 200),
        });

        // More lenient validation - just check if it's an array with the expected structure
        if (!Array.isArray(rawData) || !Array.isArray(rawData[0])) {
          logger.error("[translation] Invalid API response structure", {
            rawData,
          });
          throw new Error("Invalid translation API response structure");
        }

        // At this point, rawData is guaranteed to be an array
        // Type assertion is safe here because we've validated the structure above
        const data: unknown[] = rawData;

        // Safely extract translations from nested structure
        const firstElement: unknown = data[0];
        if (!Array.isArray(firstElement)) {
          throw new Error("Translation data format unexpected");
        }

        const translatedText = firstElement
          .filter(
            (item: unknown): item is unknown[] => Array.isArray(item) && typeof item[0] === "string"
          )
          .map((item: unknown[]) => String(item[0]))
          .join("");

        // Detect source language (data[2] contains detected language)
        const detectedLang = typeof data[2] === "string" ? data[2] : sl;

        // Store in cache for future use
        if (db) {
          try {
            const cacheId = crypto.randomUUID();
            const now = Date.now();
            const { sql } = await import("drizzle-orm");

            // Use upsert: insert or update if already exists, return the record
            const [upsertedRecord] = await db
              .insert(translationCache)
              .values({
                id: cacheId,
                sourceText: cleanText,
                sourceLang: sl,
                targetLang: tl,
                translatedText,
                detectedLang,
                queryCount: 1, // First query for this translation
                firstQueriedAt: now, // Record when user first encountered this
                lastQueriedAt: now, // Same as first for initial entry
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: [
                  translationCache.sourceText,
                  translationCache.sourceLang,
                  translationCache.targetLang,
                ],
                set: {
                  queryCount: sql`${translationCache.queryCount} + 1`,
                  lastQueriedAt: now,
                  updatedAt: now,
                },
              })
              .returning();

            const actualCacheId = upsertedRecord.id;

            logger.debug("[translation] Cached translation", {
              sourceText: cleanText,
              sourceLang: sl,
              targetLang: tl,
              queryCount: upsertedRecord.queryCount,
            });

            // Save video context
            try {
              await db
                .insert(translationContexts)
                .values({
                  id: crypto.randomUUID(),
                  translationId: actualCacheId,
                  videoId: input.videoId,
                  timestampSeconds: Math.floor(input.timestampSeconds),
                  contextText: input.contextText ?? null,
                  createdAt: now,
                })
                .onConflictDoNothing();

              logger.debug("[translation] Saved video context for new translation", {
                translationId: actualCacheId,
                videoId: input.videoId,
                timestamp: input.timestampSeconds,
              });
            } catch (contextError) {
              logger.warn("[translation] Failed to save video context", {
                error: String(contextError),
              });
            }

            // Return with translationId for saving to My Words
            return {
              success: true as const,
              translation: translatedText,
              translationId: actualCacheId,
              originalText: cleanText,
              sourceLang: detectedLang,
              targetLang: tl,
              fromCache: false,
            };
          } catch (cacheError) {
            logger.warn("[translation] Failed to cache translation", {
              error: String(cacheError),
            });
            // Don't fail the translation if caching fails
          }
        }

        return {
          success: true as const,
          translation: translatedText,
          translationId: "", // No ID if caching failed
          originalText: cleanText,
          sourceLang: detectedLang,
          targetLang: tl,
          fromCache: false,
        };
      } catch (e) {
        logger.error("[translation] Failed to translate text", {
          text: input.text,
          error: String(e),
        });
        return {
          success: false as const,
          message: `Translation failed: ${String(e)}`,
        };
      }
    }),

  openLocalFile: publicProcedure
    .input(
      z.object({
        filePath: z.string(),
      })
    )
    .mutation(async ({ input }): Promise<OpenLocalFileResult> => {
      try {
        await shell.openPath(input.filePath);
        return { success: true };
      } catch (error) {
        logger.error("Failed to open local file:", error);
        return { success: false, error: String(error) };
      }
    }),

  openFolder: publicProcedure
    .input(
      z.object({
        folderPath: z.string(),
      })
    )
    .mutation(async ({ input }): Promise<OpenFolderResult> => {
      try {
        await shell.openPath(input.folderPath);
        return { success: true };
      } catch (error) {
        logger.error("Failed to open folder:", error);
        return { success: false, error: String(error) };
      }
    }),

  selectFolder: publicProcedure
    .input(
      z.object({
        defaultPath: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<SelectFolderResult> => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
          defaultPath: input.defaultPath,
          title: "Select Download Folder",
          message: "Choose a folder to save downloaded videos",
        });

        if (result.canceled) {
          return { success: false, cancelled: true };
        }

        const folderPath = result.filePaths[0];
        if (!folderPath) {
          return { success: false, cancelled: true };
        }

        return { success: true, folderPath };
      } catch (error) {
        logger.error("Failed to select folder:", error);
        return { success: false, cancelled: false, error: String(error) };
      }
    }),

  selectDatabaseFile: publicProcedure
    .input(
      z.object({
        defaultPath: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<SelectDatabaseFileResult> => {
      try {
        const result = await dialog.showSaveDialog({
          defaultPath: input.defaultPath,
          title: "Choose Database File",
          message: "Choose where LearnifyTube should store its database",
          nameFieldLabel: "Database file",
          filters: [
            {
              name: "SQLite Database",
              extensions: ["db", "sqlite", "sqlite3"],
            },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, cancelled: true };
        }

        return { success: true, filePath: path.resolve(result.filePath) };
      } catch (error) {
        logger.error("Failed to select database file:", error);
        return { success: false, cancelled: false, error: String(error) };
      }
    }),

  updateDatabasePath: publicProcedure
    .input(
      z.object({
        filePath: z.string().nullable(),
      })
    )
    .mutation(async ({ input }): Promise<UpdateDatabasePathResult> => {
      try {
        const defaultPath = getDefaultDatabaseFilePath();
        const requestedPath = path.resolve(input.filePath ?? defaultPath);
        const currentPath = getActiveDatabaseFilePath();
        const willUseDefaultPath = requestedPath === defaultPath;

        let copiedExistingData = false;
        let usedExistingDatabase = false;

        if (requestedPath !== currentPath) {
          if (fs.existsSync(requestedPath)) {
            usedExistingDatabase = true;
          } else {
            copiedExistingData = await copyActiveDatabaseToPath(requestedPath);
          }
        }

        if (willUseDefaultPath) {
          clearConfiguredDatabaseFilePath();
        } else {
          setConfiguredDatabaseFilePath(requestedPath);
        }

        logger.info("[utils] Updated database path", {
          currentPath,
          requestedPath,
          copiedExistingData,
          usedExistingDatabase,
          willUseDefaultPath,
        });

        return {
          success: true,
          path: requestedPath,
          copiedExistingData,
          usedExistingDatabase,
          isDefault: willUseDefaultPath,
          requiresRestart: requestedPath !== currentPath,
        };
      } catch (error) {
        logger.error("Failed to update database path:", error);
        return { success: false, error: String(error) };
      }
    }),

  quitApp: publicProcedure.mutation(async (): Promise<QuitAppResult> => {
    try {
      logger.info("Quitting application...");
      app.quit();
      return { success: true };
    } catch (error) {
      logger.error("Failed to quit app:", error);
      return { success: false, error: String(error) };
    }
  }),

  restartApp: publicProcedure.mutation(async (): Promise<RestartAppResult> => {
    try {
      logger.info("Restarting application...");

      setTimeout(() => {
        app.relaunch();
        app.quit();
      }, 150);

      return { success: true };
    } catch (error) {
      logger.error("Failed to restart app:", error);
      return { success: false, error: String(error) };
    }
  }),

  // Get current app version
  getAppVersion: publicProcedure.query((): GetAppVersionResult => {
    return { version: app.getVersion() };
  }),

  // Get log file content
  getLogFileContent: publicProcedure.query(async (): Promise<GetLogFileContentResult> => {
    try {
      const [content, path] = await Promise.all([logger.getFileContent(), logger.getFilePath()]);
      const exists = Boolean(path && fs.existsSync(path));
      return { content, path, exists };
    } catch (error) {
      logger.error("Failed to get log file content", error);
      throw error;
    }
  }),

  // Clear log file content
  clearLogFile: publicProcedure.mutation(async (): Promise<ClearLogFileResult> => {
    try {
      await logger.clearLogFile();
      return { success: true } as const;
    } catch (error) {
      logger.error("Failed to clear log file", error);
      return { success: false, error: String(error) } as const;
    }
  }),

  openNotificationWindow: publicProcedure
    .input(
      z
        .object({
          title: z.string(),
          description: z.string(),
          autoDismiss: z.boolean().optional(), // Optional auto-dismiss setting
        })
        .optional()
    )
    .mutation(async ({ input }) => {
      try {
        const window = await createNotificationWindow();

        // If data is provided, send it to the notification window
        if (input) {
          const success = await sendNotificationToWindow({
            title: input.title,
            body: input.description,
            autoDismiss: input.autoDismiss ?? false, // Default is false
          });
          return { success };
        }

        return { success: !!window };
      } catch (error) {
        logger.error("Failed to open notification window", error);
        return { success: false, error: String(error) };
      }
    }),
  // Version checking procedure
  checkForUpdates: publicProcedure.query(async (): Promise<CheckForUpdatesResult> => {
    const currentVersionRaw = app.getVersion();
    const currentVersion = normalizeVersion(currentVersionRaw);

    try {
      logger.info("[updates] Checking for updates...");
      const response = await fetch(GITHUB_RELEASES_URL, {
        headers: {
          "User-Agent": "LearnifyTube-Updater",
          Accept: "application/vnd.github+json",
        },
      });

      if (!response.ok) {
        logger.error("[updates] Failed to fetch releases:", response.statusText);
        return {
          updateAvailable: false,
          latestVersion: currentVersion,
          currentVersion,
        };
      }

      const releasesData: unknown = await response.json();
      const releases: unknown[] = Array.isArray(releasesData) ? releasesData : [];
      const releaseData = releases.find(
        (item) =>
          isRecord(item) &&
          item.draft !== true &&
          item.prerelease !== true &&
          typeof item.tag_name === "string" &&
          DESKTOP_RELEASE_TAG.test(item.tag_name)
      );
      const release: GitHubRelease = {};

      if (isRecord(releaseData)) {
        if (typeof releaseData.tag_name === "string") {
          release.tag_name = releaseData.tag_name;
        }
        if (typeof releaseData.body === "string") {
          release.body = releaseData.body;
        }
      }
      const latestVersion = release?.tag_name ? normalizeVersion(release.tag_name) : currentVersion;

      if (!latestVersion) {
        logger.warn("[updates] Latest version missing from release payload");
        return {
          updateAvailable: false,
          latestVersion: currentVersion,
          currentVersion,
        };
      }

      const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

      if (!hasUpdate) {
        logger.info("[updates] No updates available");
        return {
          updateAvailable: false,
          latestVersion,
          currentVersion,
        };
      }

      const downloadUrl = getPlatformDownloadUrl(latestVersion);
      const releaseNotes = typeof release?.body === "string" ? release.body : "";

      logger.info("[updates] Update available:", latestVersion);

      return {
        updateAvailable: true,
        latestVersion,
        currentVersion,
        downloadUrl,
        releaseNotes,
      };
    } catch (error) {
      logger.error("[updates] Failed to check for updates", error);
      return {
        updateAvailable: false,
        latestVersion: currentVersion,
        currentVersion,
      };
    }
  }),

  // Download update procedure with progress tracking
  downloadUpdate: publicProcedure
    .input(
      z.object({
        downloadUrl: z.string().url(),
      })
    )
    .mutation(async ({ input }): Promise<DownloadUpdateResult> => {
      const { downloadUrl } = input;

      try {
        logger.info("Starting download from:", downloadUrl);

        // Get the download directory
        const downloadsDir = path.join(os.homedir(), "Downloads");

        // Extract filename from URL
        const urlParts = downloadUrl.split("/");
        const filename = urlParts[urlParts.length - 1] || "LearnifyTube-update.dmg";
        const filePath = path.join(downloadsDir, filename);

        // Ensure downloads directory exists
        if (!fs.existsSync(downloadsDir)) {
          fs.mkdirSync(downloadsDir, { recursive: true });
        }

        return new Promise<DownloadUpdateResult>((resolve, reject) => {
          // Helper to perform download and follow redirects up to maxRedirects
          const maxRedirects = 5;

          const doRequest = (urlToFetch: string, redirectsLeft: number): void => {
            let request;
            try {
              request = net.request({ method: "GET", url: urlToFetch });
            } catch (err) {
              logger.error("Failed to create net.request:", err);
              return reject({
                status: "error",
                message: `Failed to start download: ${String(err)}`,
              });
            }

            request.on("response", (response) => {
              const statusCode = response.statusCode || 0;
              logger.info(`Download response status: ${statusCode}`);

              // Handle redirects manually
              if (statusCode >= 300 && statusCode < 400 && redirectsLeft > 0) {
                const locationHeader = response.headers["location"] || response.headers["Location"];
                const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader;
                if (location) {
                  logger.info("Redirecting download to:", location);
                  // Drain response and start new request to location
                  response.on("data", () => {});
                  response.on("end", () => {
                    doRequest(location, redirectsLeft - 1);
                  });
                  return;
                }
              }

              if (statusCode >= 400) {
                logger.error(
                  "Download failed, status code:",
                  statusCode,
                  "headers:",
                  response.headers
                );
                // consume response and reject
                response.on("data", () => {});
                response.on("end", () => {
                  reject({ status: "error", message: `Download failed with status ${statusCode}` });
                });
                return;
              }

              logger.info(
                `Starting download, content-length: ${response.headers["content-length"] || "unknown"} bytes`
              );

              const writeStream = fs.createWriteStream(filePath);

              response.on("data", (chunk) => {
                writeStream.write(chunk);
              });

              response.on("end", () => {
                writeStream.end();
                logger.info("Download completed:", filePath);

                resolve({
                  status: "success",
                  message: "Download completed successfully",
                  filePath,
                  filename,
                });
              });

              response.on("error", (error) => {
                writeStream.destroy();
                logger.error("Download stream error:", error);
                reject({
                  status: "error",
                  message: "Download failed",
                });
              });
            });

            request.on("error", (error) => {
              logger.error("Download request error:", error);
              reject({
                status: "error",
                message: `Failed to start download: ${String(error)}`,
              });
            });

            request.end();
          };

          // Kick off the request
          doRequest(downloadUrl, maxRedirects);
        });
      } catch (error) {
        logger.error("Failed to download update", error);
        return {
          status: "error" as const,
          message: "Failed to download update",
        };
      }
    }),

  closeNotificationWindow: publicProcedure.mutation((): CloseNotificationWindowResult => {
    try {
      closeWindow();
      return { success: true };
    } catch (error) {
      logger.error("Failed to close notification window", error);
      return { success: false, error: String(error) };
    }
  }),
  // Check if update file already exists
  checkExistingUpdate: publicProcedure
    .input(
      z.object({
        version: z.string(),
      })
    )
    .query(async ({ input }) => {
      const { version } = input;

      try {
        // Use a more reliable way to detect platform in main process
        const platform = process.platform;
        const arch = process.arch;
        const expectedFilename = `learnifytube-${platform}-${arch}-${version}.zip`;
        const downloadsDir = path.join(os.homedir(), "Downloads");
        const expectedPath = path.join(downloadsDir, expectedFilename);

        // Check if file exists
        if (fs.existsSync(expectedPath)) {
          logger.info("Found existing downloaded file:", expectedPath);
          return {
            exists: true,
            filePath: expectedPath,
          };
        }

        return {
          exists: false,
          filePath: null,
        };
      } catch (error) {
        logger.error("Error checking for existing file:", error);
        return {
          exists: false,
          filePath: null,
          error: String(error),
        };
      }
    }),
  // Direct notification send procedure (uses the new IPC channel)
  sendNotification: publicProcedure
    .input(
      z.object({
        title: z.string(),
        description: z.string(),
        autoDismiss: z.boolean().optional(), // Optional auto-dismiss setting
      })
    )
    .mutation(async ({ input }): Promise<SendNotificationResult> => {
      try {
        const success = await sendNotificationToWindow({
          title: input.title,
          body: input.description,
          autoDismiss: input.autoDismiss ?? false, // Default is false
        });

        return { success };
      } catch (error) {
        logger.error("Failed to send notification", error);
        return { success: false, error: String(error) };
      }
    }),
  installUpdate: publicProcedure
    .input(
      z.object({
        zipFilePath: z.string(),
        version: z.string(),
      })
    )
    .mutation(async ({ input }): Promise<InstallUpdateResult> => {
      try {
        const { zipFilePath, version } = input;
        await extractZipWithYauzl(zipFilePath, version);
        return {
          status: "success",
          message: "Update installed successfully",
          fallbackUrl: null,
          downloadUrl: null,
        };
      } catch (error) {
        logger.error("Failed to install update", error);
        return { status: "error" as const, message: "Failed to install update" };
      }
    }),

  // Get database path
  getDatabasePath: publicProcedure.query((): GetDatabasePathResult => {
    const dbPath = getDatabasePath();
    // Remove 'file:' prefix to get actual file system path
    const actualPath = dbPath.replace(/^file:/, "");

    // Get absolute path
    const absolutePath = path.isAbsolute(actualPath)
      ? actualPath
      : path.resolve(process.cwd(), actualPath);

    return {
      path: absolutePath,
      directory: path.dirname(absolutePath),
      exists: fs.existsSync(absolutePath),
      size: fs.existsSync(absolutePath) ? fs.statSync(absolutePath).size : 0,
      defaultPath: getDefaultDatabaseFilePath(),
      isDefault: isUsingDefaultDatabasePath(),
    };
  }),

  convertImageToDataUrl: publicProcedure
    .input(
      z.object({
        imagePath: z.string(),
      })
    )
    .query(async ({ input }) => {
      try {
        const { imagePath } = input;

        // Check if file exists - this is expected behavior for lazy-loaded thumbnails
        // so we don't log it as a warning to reduce log noise
        if (!fs.existsSync(imagePath)) {
          return null;
        }

        // Read the file as a buffer
        const imageBuffer = fs.readFileSync(imagePath);

        // Get the file extension to determine MIME type
        const ext = path.extname(imagePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".bmp": "image/bmp",
        };

        const mimeType = mimeTypes[ext] || "image/jpeg";

        // Convert to base64 data URL
        const base64Image = imageBuffer.toString("base64");
        return `data:${mimeType};base64,${base64Image}`;
      } catch (error) {
        logger.error("Error converting image to data URL:", error);
        return null;
      }
    }),
});
