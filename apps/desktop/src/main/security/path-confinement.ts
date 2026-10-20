import * as fs from "fs";
import * as path from "path";

/**
 * Result of checking whether a requested path is allowed to be served.
 * On success, `realPath` is the canonical (symlink-resolved) absolute path
 * that callers should use for any filesystem access.
 */
export type ConfinementResult =
  | { ok: true; realPath: string }
  | { ok: false; reason: "invalid" | "not-found" | "outside-allowed" };

const realpathOrNull = (target: string): string | null => {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
};

/**
 * True when `target` is the same as, or nested inside, `base`.
 * Both arguments must already be absolute, real (symlink-resolved) paths.
 * Uses path.relative rather than string startsWith so that sibling
 * directories sharing a prefix (e.g. "/a/base-evil" vs "/a/base") are not
 * mistaken for descendants.
 */
const isWithin = (base: string, target: string): boolean => {
  const rel = path.relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/**
 * Decide whether `requestedPath` may be served, confining it to one of
 * `allowedBaseDirs`.
 *
 * The requested file must exist; its real path (after resolving symlinks) must
 * live inside one of the allowed base directories (also symlink-resolved). This
 * defeats `..` traversal, absolute paths outside the allowlist, and symlinks
 * that point outside it.
 *
 * Callers are responsible for URL-decoding before calling. Relative inputs are
 * resolved against the process working directory, which will normally fall
 * outside the allowlist and be rejected — pass absolute paths.
 */
export const resolveWithinAllowed = (
  requestedPath: string,
  allowedBaseDirs: string[]
): ConfinementResult => {
  if (typeof requestedPath !== "string" || requestedPath.length === 0) {
    return { ok: false, reason: "invalid" };
  }

  const realTarget = realpathOrNull(path.resolve(requestedPath));
  if (!realTarget) {
    return { ok: false, reason: "not-found" };
  }

  for (const baseDir of allowedBaseDirs) {
    if (typeof baseDir !== "string" || baseDir.length === 0) {
      continue;
    }
    const realBase = realpathOrNull(path.resolve(baseDir));
    if (!realBase) {
      continue;
    }
    if (isWithin(realBase, realTarget)) {
      return { ok: true, realPath: realTarget };
    }
  }

  return { ok: false, reason: "outside-allowed" };
};

const AUDIO_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".m4b": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
};

export type TrackFileResult =
  | { ok: true; realPath: string; contentType: string }
  | { ok: false; reason: "unknown-track" | "not-found" | "not-audio" };

/**
 * Decide whether an Audiobook Track's file may be served. Track files live in
 * the user's own folders, outside every allowed directory, so they are allowed
 * one by one: only the file recorded for a Track of an imported Audiobook,
 * found by Track id (never by a path from the request), and only when it is a
 * regular audio file once symlinks are resolved.
 */
export const resolveAudiobookTrackFile = async (
  trackId: string,
  findTrackFilePath: (trackId: string) => Promise<string | null>
): Promise<TrackFileResult> => {
  const recorded = trackId ? await findTrackFilePath(trackId) : null;
  if (!recorded) {
    return { ok: false, reason: "unknown-track" };
  }
  return resolveAudioFile(recorded);
};

/**
 * The form of a local file path two paths are compared in. A Windows path asked
 * for over `local-file://` arrives as `/C:/Books/a.mp3` and is recorded as
 * `C:\\Books\\a.mp3`, with any drive-letter and name case: both resolve to one
 * key. Elsewhere paths are resolved and compared case-sensitively.
 */
export const localFileKey = (filePath: string, platform: string = process.platform): string => {
  if (platform !== "win32") return path.posix.resolve(filePath);
  const withoutLeadingSlash = filePath.replace(/^[\\/]+(?=[a-zA-Z]:)/, "");
  return path.win32.resolve(withoutLeadingSlash).toLowerCase();
};

/**
 * The local file path a path asked for over `local-file://` names: on Windows
 * `/C:/Books/a.mp3` is `C:\\Books\\a.mp3`.
 */
export const localFilePath = (
  requestedPath: string,
  platform: string = process.platform
): string =>
  platform === "win32" ? requestedPath.replace(/^[\\/]+(?=[a-zA-Z]:)/, "") : requestedPath;

export type TrackFileAllowlist = {
  resolve: (requestedPath: string) => Promise<TrackFileResult>;
  /** Tracks were added, moved or removed: read the recorded files again. */
  tracksChanged: () => void;
};

/**
 * Decides whether a path asked for over `local-file://` is an Audiobook Track's
 * file the desktop may play: only a path recorded for a Track of an imported
 * Audiobook (so a neighbouring file stays out of reach), and only when it is a
 * regular audio file once symlinks are resolved.
 *
 * The recorded Track files are read once and kept, and each Track's resolved
 * file is kept once found, so the Range requests of a playing Track do no
 * database query or realpath. Call `tracksChanged` when Tracks are added,
 * moved or removed.
 */
export const createTrackFileAllowlist = (
  loadTrackFilePaths: () => Promise<string[]>,
  platform: string = process.platform
): TrackFileAllowlist => {
  let recorded: Promise<Map<string, string>> | null = null;
  const resolved = new Map<string, TrackFileResult>();

  const load = (): Promise<Map<string, string>> => {
    recorded ??= loadTrackFilePaths().then(
      (paths) => new Map(paths.map((filePath) => [localFileKey(filePath, platform), filePath]))
    );
    // A failed read is tried again at the next request.
    recorded.catch(() => {
      recorded = null;
    });
    return recorded;
  };

  return {
    resolve: async (requestedPath: string): Promise<TrackFileResult> => {
      if (!requestedPath) return { ok: false, reason: "unknown-track" };
      const key = localFileKey(requestedPath, platform);
      const kept = resolved.get(key);
      if (kept) return kept;
      const trackFile = (await load()).get(key);
      if (!trackFile) return { ok: false, reason: "unknown-track" };
      const result = resolveAudioFile(trackFile);
      if (result.ok) resolved.set(key, result);
      return result;
    },
    tracksChanged: (): void => {
      recorded = null;
      resolved.clear();
    },
  };
};

const resolveAudioFile = (recorded: string): TrackFileResult => {
  const realPath = realpathOrNull(path.resolve(recorded));
  if (!realPath) {
    return { ok: false, reason: "not-found" };
  }

  const contentType = AUDIO_CONTENT_TYPES[path.extname(realPath).toLowerCase()];
  if (!contentType || !fs.statSync(realPath).isFile()) {
    return { ok: false, reason: "not-audio" };
  }

  return { ok: true, realPath, contentType };
};
