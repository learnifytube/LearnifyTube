import * as crypto from "crypto";
import * as fs from "fs";

/**
 * Compute the SHA-256 hex digest of a file on disk.
 */
export const sha256OfFile = (filePath: string): string => {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
};

/**
 * Compare a computed digest against an expected value from SHA2-256SUMS.
 * Accepts optional `sha256:` prefix and is case-insensitive.
 */
export const matchesExpected = (actual: string, expected: string): boolean => {
  const normalize = (value: string): string => {
    const trimmed = value.trim().toLowerCase();
    return trimmed.startsWith("sha256:") ? trimmed.slice("sha256:".length) : trimmed;
  };

  const normalizedActual = normalize(actual);
  const normalizedExpected = normalize(expected);

  if (normalizedActual.length === 0 || normalizedExpected.length === 0) {
    return false;
  }

  if (normalizedActual.length !== normalizedExpected.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(normalizedActual, "hex"),
      Buffer.from(normalizedExpected, "hex")
    );
  } catch {
    return false;
  }
};

/**
 * Parse a SHA2-256SUMS file and return the hash for `assetName`, if present.
 * Lines follow the standard `hash  filename` format.
 */
export const parseChecksumForAsset = (sumsContent: string, assetName: string): string | null => {
  for (const line of sumsContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex === -1) {
      continue;
    }
    const hash = trimmed.slice(0, spaceIndex);
    const name = trimmed
      .slice(spaceIndex + 1)
      .trim()
      .replace(/^\*/, "");
    if (name === assetName) {
      return hash;
    }
  }
  return null;
};
