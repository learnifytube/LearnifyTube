import {
  createDefaultFallbackState,
  getFallbackRetryDelayMs,
  getFormatSelector,
  getFormatSort,
  getNextFallbackState,
  shouldAutoFallback,
  PLAYER_CLIENTS,
} from "./fallback-strategy";
import {
  DEFAULT_DOWNLOAD_PREFERENCES,
  normalizeVideoDownloadQuality,
} from "@/lib/types/user-preferences";

describe("download fallback strategy", () => {
  test("default fallback state covers every player client", () => {
    const state = createDefaultFallbackState();
    expect(state.maxFallbackAttempts).toBeGreaterThanOrEqual(PLAYER_CLIENTS.length - 1);
  });

  test("default extraction path is tried before restricted clients", () => {
    expect(PLAYER_CLIENTS[0]).toBe("default");
  });

  test("429 error retries same client with delay", () => {
    const initial = createDefaultFallbackState();
    const next = getNextFallbackState(
      initial,
      "HTTP Error 429: Too Many Requests",
      "http_429_rate_limited"
    );
    expect(next).not.toBeNull();
    expect(next?.playerClientIndex).toBe(initial.playerClientIndex);
    expect(next?.fallbackAttempts).toBe(1);

    const delay = getFallbackRetryDelayMs(
      "HTTP Error 429: Too Many Requests",
      "http_429_rate_limited",
      next?.fallbackAttempts ?? 1
    );
    expect(delay).toBeGreaterThan(0);
  });

  test.each([
    ["[youtube] abc: Requested format is not available", "process_error"],
    ["[youtube] abc: The page needs to be reloaded.", "process_error"],
    ["HTTP Error 403: Forbidden", "http_403_forbidden"],
    ["No supported JavaScript runtime available", "js_runtime_missing"],
  ])("%s moves to the next player client", (message, type) => {
    const initial = createDefaultFallbackState();
    const next = getNextFallbackState(initial, message, type);
    expect(next?.playerClientIndex).toBe(initial.playerClientIndex + 1);
  });

  test("gives up after the last player client", () => {
    const last = { ...createDefaultFallbackState(), playerClientIndex: PLAYER_CLIENTS.length - 1 };
    expect(
      getNextFallbackState(last, "HTTP Error 403: Forbidden", "http_403_forbidden")
    ).toBeNull();
  });

  test("auth errors do not auto fallback", () => {
    expect(shouldAutoFallback("Sign in to confirm you're not a bot", "auth_required")).toBe(false);
  });

  test("spawn/binary availability errors do not auto fallback", () => {
    expect(shouldAutoFallback("yt-dlp binary is not available", "spawn_error")).toBe(false);
  });

  test("unavailable videos do not auto fallback", () => {
    expect(shouldAutoFallback("[youtube] abc: This video is unavailable", "process_error")).toBe(
      false
    );
  });

  test("video download quality defaults to 1080p", () => {
    expect(DEFAULT_DOWNLOAD_PREFERENCES.downloadQuality).toBe("1080p");
  });

  test("sub-720p preferences are normalized to 720p", () => {
    expect(normalizeVideoDownloadQuality(undefined)).toBe("1080p");
    expect(normalizeVideoDownloadQuality("360p")).toBe("720p");
    expect(normalizeVideoDownloadQuality("480p")).toBe("720p");
    expect(normalizeVideoDownloadQuality("720p")).toBe("720p");
    expect(normalizeVideoDownloadQuality("1080p")).toBe("1080p");
  });

  test("format selector accepts any video and never filters on resolution or codec", () => {
    for (const selector of [getFormatSelector(true), getFormatSelector(false)]) {
      expect(selector).not.toMatch(/height|ext=|vcodec/);
    }
    expect(getFormatSelector(false)).not.toContain("+");
  });

  test("Maximum quality is a sort preference, not a filter", () => {
    expect(getFormatSort("1080p")).toMatch(/^res:1080,/);
    expect(getFormatSort("720p")).toMatch(/^res:720,/);
    expect(getFormatSort("360p")).toMatch(/^res:720,/);
  });

  test("sort leaves audio language to yt-dlp so the original track wins", () => {
    expect(getFormatSort("1080p")).not.toMatch(/lang/);
  });
});
