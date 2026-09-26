import * as crypto from "crypto";
import type { IncomingHttpHeaders } from "http";

/**
 * Authorization for the LAN mobile sync server.
 *
 * A paired device presents the desktop's pairing code on every request, either
 * as `Authorization: Bearer <code>` (API calls) or as a `token` query param
 * (image/video URLs the mobile app hands to native players, which cannot set
 * headers). Browser requests — anything carrying an `Origin` header — are
 * refused unless the origin is allowlisted, so a website the user visits
 * cannot call the sync server.
 */

// Crockford-style alphabet without 0/O, 1/I/L and U, so codes are easy to read aloud and type.
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const PAIRING_CODE_LENGTH = 8;
const TOKEN_QUERY_PARAM = "token";

export type SyncAuthRequest = {
  url?: string;
  headers: IncomingHttpHeaders;
};

/**
 * On success, `url` is the request URL with the `token` query param removed,
 * safe to route on and to log.
 */
export type SyncAuthDecision = { ok: true; url: string } | { ok: false; status: 401 | 403 };

/** Append the pairing code to a URL for loaders that cannot send headers. */
export const withPairingToken = (url: string, pairingCode: string): string => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${TOKEN_QUERY_PARAM}=${encodeURIComponent(pairingCode)}`;
};

export const generatePairingCode = (): string =>
  Array.from(
    { length: PAIRING_CODE_LENGTH },
    () => PAIRING_CODE_ALPHABET[crypto.randomInt(PAIRING_CODE_ALPHABET.length)]
  ).join("");

/** Uppercase and drop separators/whitespace, so "abcd-2345" matches "ABCD2345". */
export const normalizePairingCode = (code: string): string =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, "");

const codesMatch = (presented: string, expected: string): boolean => {
  const a = normalizePairingCode(presented);
  const b = normalizePairingCode(expected);
  if (a.length === 0 || b.length === 0) {
    return false;
  }
  // Hash first so timingSafeEqual gets equal-length inputs regardless of what was presented.
  const digest = (value: string): Buffer => crypto.createHash("sha256").update(value).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
};

const readBearerToken = (headers: IncomingHttpHeaders): string | null => {
  const header = headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const match = header.match(/^Bearer\s+(.*)$/i);
  return match ? match[1] : null;
};

export const authorizeSyncRequest = (
  request: SyncAuthRequest,
  pairingCode: string,
  allowedOrigins: string[] = []
): SyncAuthDecision => {
  const origin = request.headers.origin;
  if (typeof origin === "string" && !allowedOrigins.includes(origin)) {
    return { ok: false, status: 403 };
  }

  if (!request.url) {
    return { ok: false, status: 401 };
  }

  const parsed = new URL(request.url, "http://sync.local");
  const queryToken = parsed.searchParams.get(TOKEN_QUERY_PARAM);
  parsed.searchParams.delete(TOKEN_QUERY_PARAM);

  const presented = readBearerToken(request.headers) ?? queryToken;
  if (presented === null || !codesMatch(presented, pairingCode)) {
    return { ok: false, status: 401 };
  }

  return { ok: true, url: `${parsed.pathname}${parsed.search}` };
};
