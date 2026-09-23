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
