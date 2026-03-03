import { z } from "zod";
import { publicProcedure, t } from "@/api/trpc";
import { logger } from "@/helpers/logger";
import { app } from "electron";
import fs from "fs";
import path from "path";
import { eq, sql } from "drizzle-orm";
import { videoTranscripts, youtubeVideos } from "@/api/db/schema";
import defaultDb, { type Database } from "@/api/db";
import { spawnYtDlpWithLogging } from "@/api/utils/ytdlp-utils/ytdlp";

const getTranscriptsDir = (): string => path.join(app.getPath("userData"), "cache", "transcripts");

// Zod schema for validating transcript segments from JSON (currently unused - segmentsJson cache disabled)
// const transcriptSegmentSchema = z.array(
//   z.object({
//     start: z.number(),
//     end: z.number(),
//     text: z.string(),
//   })
// );

// Return types for transcript download mutation (discriminated union for type safety)
type DownloadTranscriptSuccess = {
  success: true;
  videoId: string;
  language: string;
  length: number;
  fromCache?: boolean;
};

type DownloadTranscriptFailure =
  | {
      success: false;
      code: "RATE_LIMITED";
      retryAfterMs: number;
      message: string;
    }
  | {
      success: false;
      message: string;
    };

type DownloadTranscriptResult = DownloadTranscriptSuccess | DownloadTranscriptFailure;

function ensureDirSync(p: string): void {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
    // Ignore - directory may already exist
  }
}

/**
 * Normalize language code to base 2-letter code
 * Examples: "en-orig" -> "en", "en-us" -> "en", "vi" -> "vi"
 */
function normalizeLangCode(lang: string | null | undefined): string {
  if (!lang) return "en";
  // Extract first 2 letters (base language code)
  const normalized = lang.toLowerCase().split(/[-_]/)[0].substring(0, 2);
  return normalized || "en";
}

// Helper function to decode HTML entities in transcript text
function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&nbsp;": " ",
    "&mdash;": "\u2014",
    "&ndash;": "\u2013",
    "&hellip;": "\u2026",
    "&lsquo;": "\u2018",
    "&rsquo;": "\u2019",
    "&ldquo;": "\u201C",
    "&rdquo;": "\u201D",
  };

  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, "g"), char);
  }
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return decoded;
}

// VTT -> plain text converter
export function parseVttToText(content: string): string {
  const cleanedLines = content
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^WEBVTT/i.test(trimmed)) return false;
      if (/^NOTE/i.test(trimmed)) return false;
      if (/^Kind:/i.test(trimmed)) return false;
      if (/^Language:/i.test(trimmed)) return false;
      if (/^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->/.test(trimmed)) return false;
      if (/^\d+$/.test(trimmed)) return false;
      return true;
    })
    .map((line) => {
      const withoutTags = line.replace(/<[^>]+>/g, "");
      const normalized = withoutTags.replace(/\s+/g, " ").trim();
      return decodeHTMLEntities(normalized);
    })
    .filter((line) => line.length > 0);

  const out: string[] = [];
  const recent: string[] = [];

  for (const line of cleanedLines) {
    const lc = line.toLowerCase();
    const isRecentDup = recent.some((r) => r === lc);
    const tail = out.join(" ");
    const tailSlice = tail.slice(Math.max(0, tail.length - 600)).toLowerCase();
    const isTailDup = lc.length > 10 && tailSlice.includes(lc);

    if (isRecentDup || isTailDup) continue;

    out.push(line);
    recent.push(lc);
    if (recent.length > 8) recent.shift();
  }

  return out.join(" ").replace(/\s+/g, " ").trim();
}

// VTT -> segments with timestamps
export function parseVttToSegments(
  content: string
): Array<{ start: number; end: number; text: string }> {
  const lines = content.split(/\r?\n/);
  const segs: Array<{ start: number; end: number; text: string }> = [];
  let i = 0;
  // Track recent segments with both text and timing to avoid false duplicates
  const recent: Array<{ text: string; start: number; end: number }> = [];

  const parseTime = (t: string): number => {
    const m = t.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
    if (!m) return 0;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const ms = Number(m[4]);
    return hh * 3600 + mm * 60 + ss + ms / 1000;
  };

  while (i < lines.length) {
    const line = lines[i].trim();
    i++;
    if (!line) continue;
    if (
      /^WEBVTT/i.test(line) ||
      /^NOTE/i.test(line) ||
      /^Kind:/i.test(line) ||
      /^Language:/i.test(line)
    ) {
      continue;
    }
    if (/^\d+$/.test(line)) {
      if (i >= lines.length) break;
    }
    const timing = lines[i - 1].includes("-->") ? lines[i - 1] : (lines[i]?.trim() ?? "");
    let timingLine = timing;
    if (!/\d{2}:\d{2}:\d{2}\.\d{3}\s+--\>/.test(timingLine)) {
      if (!/\d{2}:\d{2}:\d{2}\.\d{3}\s+--\>/.test(line)) continue;
      timingLine = line;
    } else {
      i++;
    }

    const tm = timingLine.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+--\>\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (!tm) continue;
    const start = parseTime(tm[1]);
    const end = parseTime(tm[2]);

    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const raw = lines[i];
      i++;
      const withoutTags = raw.replace(/<[^>]+>/g, "");
      const cleaned = withoutTags.replace(/\s+/g, " ").trim();
      if (cleaned) textLines.push(cleaned);
    }

    const text = textLines.join(" ").trim();
    if (!text) continue;

    const decodedText = decodeHTMLEntities(text);
    const lc = decodedText.toLowerCase();

    // Check for duplicates: same text AND overlapping/very close timestamps (within 0.1s)
    // This prevents skipping valid segments that happen to have similar text
    const isDup = recent.some((r) => {
      const textMatch = r.text === lc;
      const timeOverlap = Math.abs(r.start - start) < 0.1 && Math.abs(r.end - end) < 0.1;
      // Only skip if both text AND timing are very similar (true duplicate)
      return textMatch && timeOverlap;
    });

    // Log first 20 segments for debugging
    if (segs.length < 20 || isDup) {
      if (isDup) {
        logger.debug("[parseVttToSegments] Skipping duplicate segment", {
          start,
          end,
          text: decodedText,
          textLength: decodedText.length,
          reason: "exact text and timing match in recent segments",
        });
      } else {
        logger.info("[parseVttToSegments] PARSING RAW SEGMENT", {
          index: segs.length,
          start,
          end,
          text: decodedText,
          textLength: decodedText.length,
          rawTextLines: textLines,
        });
      }
    }

    if (isDup) continue;

    segs.push({ start, end, text: decodedText });
    recent.push({ text: lc, start, end });
    if (recent.length > 16) recent.shift();
  }

  return segs;
}

async function upsertVideoSearchFts(
  db: Database,
  videoId: string,
  title: string | null | undefined,
  transcript: string | null | undefined
): Promise<void> {
  try {
    await db.run(
      sql`INSERT INTO video_search_fts (video_id, title, transcript) VALUES (${videoId}, ${title ?? ""}, ${transcript ?? ""})`
    );
  } catch {
    // Ignore - FTS table may not support this operation or entry already exists
    logger.debug("[fts] insert skipped", { videoId, reason: "already exists or error" });
  }
}

export async function downloadTranscript(
  videoId: string,
  lang?: string,
  db: Database = defaultDb
): Promise<DownloadTranscriptResult> {
  logger.info("[transcript] download called", {
    videoId,
    requestedLang: lang ?? "default",
  });

  // Check DB first
  try {
    let existing;
    if (lang) {
      const normalizedLang = normalizeLangCode(lang);
      const allTranscripts = await db
        .select()
        .from(videoTranscripts)
        .where(eq(videoTranscripts.videoId, videoId));
      existing = allTranscripts.filter((t) => normalizeLangCode(t.language) === normalizedLang);
    } else {
      existing = await db
        .select()
        .from(videoTranscripts)
        .where(eq(videoTranscripts.videoId, videoId))
        .limit(1);
    }

    if (existing.length > 0) {
      const row = existing[0];
      if (row.text && row.rawVtt && row.text.trim().length > 0 && row.rawVtt.trim().length > 0) {
        logger.info("[transcript] found existing in DB", { videoId });
        return {
          success: true,
          videoId,
          language: row.language ?? lang ?? "en",
          length: row.text.length,
          fromCache: true,
        };
      }
      // Has rawVtt but missing text - derive it
      if (row.rawVtt && row.rawVtt.trim().length > 0) {
        try {
          const derived = parseVttToText(row.rawVtt);
          const now = Date.now();
          await db
            .update(videoTranscripts)
            .set({ text: derived, segmentsJson: null, updatedAt: now })
            .where(
              sql`${videoTranscripts.videoId} = ${videoId} AND ${videoTranscripts.language} = ${row.language}`
            );

          try {
            const vid = await db
              .select({ title: youtubeVideos.title })
              .from(youtubeVideos)
              .where(eq(youtubeVideos.videoId, videoId))
              .limit(1);
            const title = vid[0]?.title ?? null;
            await upsertVideoSearchFts(db, videoId, title, derived);
          } catch {
            logger.warn("[fts] update failed", { videoId });
          }

          return {
            success: true,
            videoId,
            language: row.language ?? lang ?? "en",
            length: derived.length,
            fromCache: true,
          };
        } catch {
          logger.warn("[transcript] derive from rawVtt failed", { videoId });
        }
      }
    }
  } catch {
    logger.error("[transcript] DB check failed", { videoId });
  }

  // Download from yt-dlp
  const effectiveLang = lang ?? "en";
  const { ensureYtDlpBinaryReady } = await import("../binary");
  const ready = await ensureYtDlpBinaryReady();
  if (!ready.installed || !ready.path) {
    return {
      success: false,
      message: ready.message ?? "yt-dlp binary not installed",
    };
  }
  const binPath = ready.path;

  const transcriptsDir = getTranscriptsDir();
  ensureDirSync(transcriptsDir);
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const args = [
    "--force-ipv4",
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--no-warnings",
    "--retries",
    "2",
    "--sleep-requests",
    "2.5",
    "--sub-format",
    "vtt",
    "--sub-langs",
    `${effectiveLang},${effectiveLang}-orig,${effectiveLang}.*`,
    "-o",
    path.join(transcriptsDir, "%(id)s.%(ext)s"),
    url,
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawnYtDlpWithLogging(
        binPath,
        args,
        { stdio: ["ignore", "pipe", "pipe"] },
        {
          operation: "download_transcript",
          url,
          videoId,
          other: { language: effectiveLang },
        }
      );
      let err = "";
      proc.stderr?.on("data", (d: Buffer | string) => (err += d.toString()));
      proc.on("error", reject);
      proc.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(err || `yt-dlp exited ${code}`))
      );
    });
  } catch (e) {
    const msg = String(e);
    logger.error("[transcript] yt-dlp failed", e);
    const rateLimited = /429|Too Many Requests/i.test(msg);
    if (rateLimited) {
      return {
        success: false,
        code: "RATE_LIMITED",
        retryAfterMs: 15 * 60 * 1000,
        message: msg,
      };
    }
    return { success: false, message: msg };
  }

  // Find resulting VTT file
  let vttPath: string | null = null;
  try {
    const files = fs
      .readdirSync(transcriptsDir)
      .filter((f) => f.startsWith(videoId) && f.endsWith(".vtt"));
    if (files.length > 0) {
      const origFiles = files.filter((f) => f.includes("-orig"));
      const candidates = origFiles.length > 0 ? origFiles : files;
      const withStat = candidates.map((f) => ({
        f,
        s: fs.statSync(path.join(transcriptsDir, f)),
      }));
      withStat.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
      vttPath = path.join(transcriptsDir, withStat[0].f);

      logger.info("[transcript] Selected VTT file", {
        videoId,
        selectedFile: withStat[0].f,
        fileSize: withStat[0].s.size,
        isOrig: withStat[0].f.includes("-orig"),
        allFiles: files,
      });
    }
  } catch {
    // Ignore
  }

  if (!vttPath || !fs.existsSync(vttPath)) {
    return {
      success: false,
      message: "Transcript file not found after yt-dlp",
    };
  }

  // Parse VTT
  const raw = fs.readFileSync(vttPath, "utf8");
  const text = parseVttToText(raw);
  const now = Date.now();

  // Detect language from filename
  const langMatch = path.basename(vttPath).match(/\.(\w[\w-]*)\.vtt$/i);
  const rawDetectedLang = (langMatch?.[1] ?? effectiveLang).toLowerCase();
  const detectedLang = normalizeLangCode(rawDetectedLang);

  // Store in DB
  try {
    const existingRow = await db
      .select()
      .from(videoTranscripts)
      .where(
        sql`${videoTranscripts.videoId} = ${videoId} AND ${videoTranscripts.language} = ${detectedLang}`
      )
      .limit(1);

    if (existingRow.length === 0) {
      await db.insert(videoTranscripts).values({
        id: crypto.randomUUID(),
        videoId,
        language: detectedLang,
        isAutoGenerated: true,
        source: "yt-dlp",
        text,
        rawVtt: raw,
        segmentsJson: null,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await db
        .update(videoTranscripts)
        .set({
          isAutoGenerated: true,
          source: "yt-dlp",
          text,
          rawVtt: raw,
          segmentsJson: null,
          updatedAt: now,
        })
        .where(
          sql`${videoTranscripts.videoId} = ${videoId} AND ${videoTranscripts.language} = ${detectedLang}`
        );
    }
  } catch (e) {
    logger.error("[transcript] upsert failed", e);
    return { success: false, message: "Failed to store transcript" };
  }

  // Update FTS index
  try {
    const vid = await db
      .select({ title: youtubeVideos.title })
      .from(youtubeVideos)
      .where(eq(youtubeVideos.videoId, videoId))
      .limit(1);
    const title = vid[0]?.title ?? null;
    await upsertVideoSearchFts(db, videoId, title, text);
  } catch {
    logger.warn("[fts] update failed", { videoId });
  }

  return {
    success: true,
    videoId,
    language: detectedLang,
    length: text.length,
  };
}

export const transcriptsRouter = t.router({
  // Get transcript (if available) for a video (optionally by language)
  get: publicProcedure
    .input(z.object({ videoId: z.string(), lang: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;
      let rows;
      if (input.lang) {
        const normalizedLang = normalizeLangCode(input.lang);
        const allTranscripts = await db
          .select()
          .from(videoTranscripts)
          .where(eq(videoTranscripts.videoId, input.videoId));
        rows = allTranscripts.filter((t) => normalizeLangCode(t.language) === normalizedLang);
      } else {
        rows = await db
          .select()
          .from(videoTranscripts)
          .where(eq(videoTranscripts.videoId, input.videoId))
          .limit(1);
      }
      if (rows.length === 0) return null;

      const row = rows[0];

      // If the stored transcript still contains inline VTT tags, sanitize on read
      const t = row.text ?? "";

      const looksLikeVttInline =
        /<\d{2}:\d{2}:\d{2}\.\d{3}>|<c>|<\/c>|WEBVTT|Kind:|Language:|-->/i.test(t);
      if (looksLikeVttInline) {
        try {
          const cleaned = parseVttToText(t);
          if (cleaned && cleaned !== t) {
            const now = Date.now();
            await db
              .update(videoTranscripts)
              .set({ text: cleaned, updatedAt: now })
              .where(eq(videoTranscripts.id, row.id));

            try {
              const vid = await db
                .select({ title: youtubeVideos.title })
                .from(youtubeVideos)
                .where(eq(youtubeVideos.videoId, input.videoId))
                .limit(1);
              const title = vid[0]?.title ?? null;
              await upsertVideoSearchFts(db, input.videoId, title, cleaned);
            } catch (e) {
              logger.warn("[fts] update after transcript sanitize failed", {
                videoId: input.videoId,
                error: String(e),
              });
            }

            return { ...row, text: cleaned, updatedAt: now };
          }
        } catch (e) {
          logger.warn("[transcript] sanitize on read failed", {
            videoId: input.videoId,
            error: String(e),
          });
        }
      }

      // If text missing but rawVtt present, derive and persist
      if ((!row.text || row.text.trim().length === 0) && row.rawVtt) {
        try {
          const derived = parseVttToText(row.rawVtt);
          const now = Date.now();
          await db
            .update(videoTranscripts)
            .set({ text: derived, updatedAt: now })
            .where(eq(videoTranscripts.id, row.id));
          return { ...row, text: derived, updatedAt: now };
        } catch {
          // Ignore - VTT parsing may fail for malformed content
        }
      }

      return row;
    }),

  // Download transcript via yt-dlp and store it (for specific language)
  download: publicProcedure
    .input(z.object({ videoId: z.string(), lang: z.string().optional() }))
    .mutation(async ({ input, ctx }): Promise<DownloadTranscriptResult> => {
      const db = ctx.db ?? defaultDb;
      return downloadTranscript(input.videoId, input.lang, db);
    }),

  // Get transcript segments with timestamps for highlighting
  getSegments: publicProcedure
    .input(
      z.object({
        videoId: z.string(),
        lang: z.string().optional(),
        forceReparse: z.boolean().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = ctx.db ?? defaultDb;

      try {
        let rows;
        if (input.lang) {
          const normalizedLang = normalizeLangCode(input.lang);
          const allTranscripts = await db
            .select()
            .from(videoTranscripts)
            .where(eq(videoTranscripts.videoId, input.videoId));
          rows = allTranscripts.filter((t) => normalizeLangCode(t.language) === normalizedLang);
        } else {
          rows = await db
            .select()
            .from(videoTranscripts)
            .where(eq(videoTranscripts.videoId, input.videoId))
            .limit(1);
        }

        if (rows.length > 0) {
          const row = rows[0];

          // Always parse from rawVtt (segmentsJson cache disabled for now)
          if (row.rawVtt) {
            logger.info("[getSegments] PARSING FRESH from rawVtt", {
              videoId: input.videoId,
              lang: input.lang,
              rawVttLength: row.rawVtt.length,
            });
            const segs = parseVttToSegments(row.rawVtt);
            logger.info("[getSegments] Parsed segments from rawVtt", {
              videoId: input.videoId,
              segmentsCount: segs.length,
              firstSegment: segs[0]
                ? {
                    start: segs[0].start,
                    end: segs[0].end,
                    text: segs[0].text,
                    textLength: segs[0].text.length,
                  }
                : null,
              first5Segments: segs.slice(0, 5).map((s) => ({
                start: s.start,
                end: s.end,
                text: s.text.substring(0, 80),
              })),
            });
            return { segments: segs, language: row.language ?? input.lang } as const;
          }
        }
      } catch {
        // Ignore - DB query failure, will fall back to disk cache
      }

      // Fallback to cached VTT files on disk
      const transcriptsDir = getTranscriptsDir();
      try {
        const files = fs
          .readdirSync(transcriptsDir)
          .filter((f) => f.startsWith(input.videoId) && f.endsWith(".vtt"));
        if (files.length === 0)
          return {
            segments: [],
            language: input.lang,
          } as const;

        const pickByLang = (lang: string, arr: string[]): string[] => {
          const re = new RegExp(`\\.${lang}(?:[.-]|\\.vtt$)`, "i");
          const candidates = arr.filter((f) => re.test(f));
          if (candidates.length > 0) return candidates;
          return arr;
        };

        const candidates = input.lang ? pickByLang(input.lang, files) : files;

        // Prefer -orig files (original with timing tags) over cleaned versions
        const origFiles = candidates.filter((f) => f.includes("-orig"));
        const preferredCandidates = origFiles.length > 0 ? origFiles : candidates;

        const withStat = preferredCandidates.map((f) => ({
          f,
          s: fs.statSync(path.join(transcriptsDir, f)),
        }));
        withStat.sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
        const vttPath = path.join(transcriptsDir, withStat[0].f);

        logger.info("[getSegments] FALLBACK: Selected VTT file from disk cache", {
          videoId: input.videoId,
          selectedFile: withStat[0].f,
          fileSize: withStat[0].s.size,
          isOrig: withStat[0].f.includes("-orig"),
          allFiles: files,
        });
        logger.info("[getSegments] FALLBACK: Parsing from disk cache VTT file", {
          videoId: input.videoId,
          lang: input.lang,
          vttPath,
        });
        const raw = fs.readFileSync(vttPath, "utf8");
        const segments = parseVttToSegments(raw);
        logger.info("[getSegments] Parsed segments from disk cache", {
          videoId: input.videoId,
          segmentsCount: segments.length,
          firstSegment: segments[0]
            ? {
                start: segments[0].start,
                end: segments[0].end,
                text: segments[0].text,
                textLength: segments[0].text.length,
              }
            : null,
          first5Segments: segments.slice(0, 5).map((s) => ({
            start: s.start,
            end: s.end,
            text: s.text.substring(0, 80),
          })),
        });
        return { segments, language: input.lang } as const;
      } catch {
        // Ignore - VTT parsing or file reading may fail
        return {
          segments: [],
          language: input.lang,
        } as const;
      }
    }),
});

// Router type not exported (unused)
