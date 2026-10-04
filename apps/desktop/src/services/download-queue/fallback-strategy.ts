import { normalizeVideoDownloadQuality, type DownloadQuality } from "@/lib/types/user-preferences";
import { logger } from "@/helpers/logger";

/**
 * Player clients in fallback order (most reliable first based on testing)
 * - default: Lets yt-dlp choose the best extraction path (best quality when JS challenges can be solved)
 * - android: Reliable fallback when default/web extraction is degraded
 * - ios: Good alternative for restricted content
 * - tv: Simple client, often works when others fail
 * - mweb: Mobile web client
 * - web_safari: Safari web client (avoids some restrictions)
 * - web: Standard web client (last resort, may hit SABR issues)
 */
export const PLAYER_CLIENTS = [
  "default",
  "android",
  "ios",
  "tv",
  "mweb",
  "web_safari",
  "web",
] as const;

export type PlayerClient = (typeof PLAYER_CLIENTS)[number];

/**
 * Fallback state tracking
 */
export interface FallbackState {
  playerClientIndex: number;
  fallbackAttempts: number;
  maxFallbackAttempts: number;
}

/**
 * Error types that trigger specific fallback actions
 */
type FallbackAction = "next_client" | "delay_retry" | "no_fallback";

/**
 * Get player client by index
 */
export const getPlayerClient = (index: number): PlayerClient => {
  const clampedIndex = Math.max(0, Math.min(index, PLAYER_CLIENTS.length - 1));
  return PLAYER_CLIENTS[clampedIndex];
};

/**
 * Any format with a video track is accepted; this only decides which one yt-dlp tries first.
 * Without ffmpeg, separate video and audio streams can't be merged, so take a single file.
 */
export const getFormatSelector = (canMerge: boolean): string => (canMerge ? "bv*+ba/b" : "b");

/**
 * Sort order for yt-dlp (-S). The Maximum quality is a ceiling, never a requirement:
 * sorting prefers resolutions up to it but still falls back to whatever YouTube offers.
 * VP9 is preferred over AV1, which older Android TV boxes can't decode in hardware.
 */
export const getFormatSort = (quality: DownloadQuality): string => {
  const maxHeight = normalizeVideoDownloadQuality(quality) === "720p" ? 720 : 1080;
  return `res:${maxHeight},vcodec:vp9,acodec:opus`;
};

/**
 * Determine fallback action based on error message and type
 */
const determineFallbackAction = (errorMessage: string, errorType: string): FallbackAction => {
  const lowerMessage = errorMessage.toLowerCase();
  const lowerType = errorType.toLowerCase();

  // Don't retry non-recoverable content states.
  if (
    lowerMessage.includes("video unavailable") ||
    lowerMessage.includes("private video") ||
    lowerMessage.includes("this video is unavailable") ||
    lowerMessage.includes("copyright") ||
    lowerMessage.includes("requested video is unavailable")
  ) {
    return "no_fallback";
  }

  // No fallback for auth-required errors
  if (
    lowerType === "spawn_error" ||
    lowerMessage.includes("yt-dlp binary is not available") ||
    lowerMessage.includes("yt-dlp binary not installed") ||
    lowerMessage.includes("sign-in") ||
    lowerMessage.includes("sign in") ||
    lowerMessage.includes("login") ||
    lowerMessage.includes("age-restricted") ||
    lowerType === "auth_required"
  ) {
    return "no_fallback";
  }

  // Transient network failures and rate limiting retry the same client after a delay.
  if (
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("connection reset") ||
    lowerMessage.includes("temporary failure in name resolution") ||
    lowerMessage.includes("name or service not known") ||
    lowerMessage.includes("nodename nor servname") ||
    lowerMessage.includes("http error 429") ||
    lowerType === "http_429_rate_limited"
  ) {
    return "delay_retry";
  }

  // Anything else (403, SABR, missing formats, JS challenges, reload prompts) is usually
  // specific to how one client talks to YouTube, so try the next one.
  return "next_client";
};

/**
 * Check if error is eligible for automatic fallback
 */
export const shouldAutoFallback = (errorMessage: string, errorType: string): boolean => {
  const action = determineFallbackAction(errorMessage, errorType);
  return action !== "no_fallback";
};

/**
 * Get next fallback state based on current state and error type
 * Returns null if no more fallbacks are available
 */
export const getNextFallbackState = (
  current: FallbackState,
  errorMessage: string,
  errorType: string
): FallbackState | null => {
  // Check if we've exceeded max attempts
  if (current.fallbackAttempts >= current.maxFallbackAttempts) {
    logger.debug("[fallback-strategy] Max fallback attempts reached", {
      attempts: current.fallbackAttempts,
      max: current.maxFallbackAttempts,
    });
    return null;
  }

  const action = determineFallbackAction(errorMessage, errorType);

  if (action === "no_fallback") {
    logger.debug("[fallback-strategy] Error not eligible for fallback", {
      errorMessage,
      errorType,
    });
    return null;
  }

  const nextClientIndex =
    action === "next_client" ? current.playerClientIndex + 1 : current.playerClientIndex;

  if (nextClientIndex >= PLAYER_CLIENTS.length) {
    logger.debug("[fallback-strategy] All player clients exhausted");
    return null;
  }

  const nextState: FallbackState = {
    playerClientIndex: nextClientIndex,
    fallbackAttempts: current.fallbackAttempts + 1,
    maxFallbackAttempts: current.maxFallbackAttempts,
  };

  logger.info("[fallback-strategy] Advancing to next fallback", {
    previousClient: PLAYER_CLIENTS[current.playerClientIndex],
    nextClient: PLAYER_CLIENTS[nextClientIndex],
    attempt: nextState.fallbackAttempts,
    maxAttempts: nextState.maxFallbackAttempts,
    action,
  });

  return nextState;
};

/**
 * Create initial fallback state for a new download
 */
export const createInitialFallbackState = (maxAttempts = 10): FallbackState => ({
  playerClientIndex: 0,
  fallbackAttempts: 0,
  maxFallbackAttempts: maxAttempts,
});

// Every client once, plus room for a few delayed retries on rate limits and timeouts.
export const createDefaultFallbackState = (): FallbackState =>
  createInitialFallbackState(PLAYER_CLIENTS.length * 2);

export const getFallbackRetryDelayMs = (
  errorMessage: string,
  errorType: string,
  fallbackAttempt: number
): number => {
  const lowerMessage = errorMessage.toLowerCase();
  const lowerType = errorType.toLowerCase();
  const baseDelay = 3_000;
  const cappedAttempt = Math.min(Math.max(fallbackAttempt, 1), 6);

  if (
    lowerType === "http_429_rate_limited" ||
    lowerMessage.includes("http error 429") ||
    lowerMessage.includes("too many requests")
  ) {
    return Math.min(baseDelay * 2 ** cappedAttempt, 120_000);
  }

  if (
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("connection reset") ||
    lowerMessage.includes("temporary failure in name resolution") ||
    lowerMessage.includes("name or service not known") ||
    lowerMessage.includes("nodename nor servname")
  ) {
    return Math.min(baseDelay * cappedAttempt, 30_000);
  }

  return 0;
};

/**
 * Get human-readable fallback status string for UI display
 */
export const getFallbackStatusString = (state: FallbackState): string | null => {
  if (state.fallbackAttempts === 0) {
    return null; // No fallback yet, don't show anything
  }

  const client = PLAYER_CLIENTS[state.playerClientIndex];

  return `Fallback ${state.fallbackAttempts}/${state.maxFallbackAttempts}: ${client} client`;
};
