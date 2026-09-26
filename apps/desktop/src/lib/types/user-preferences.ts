/**
 * User Preferences System for LearnifyTube
 * Allows users to customize their learning experience
 */

export type ThemeMode = "light" | "dark";

export type SidebarItem =
  | "home"
  | "library"
  | "dashboard"
  | "channels"
  | "playlists"
  | "my-playlists"
  | "subscriptions"
  | "history"
  | "my-words"
  | "flashcards"
  | "analytics"
  | "storage"
  | "mobile-sync"
  | "logs"
  | "settings";

export type UISize = "compact" | "comfortable" | "spacious";
export type FontScale = "small" | "normal" | "large" | "x-large";
export type AnimationSpeed = "none" | "reduced" | "normal" | "enhanced";
export type DownloadQuality = "360p" | "480p" | "720p" | "1080p";
export const YT_DLP_COOKIE_BROWSERS = [
  "none",
  "safari",
  "chrome",
  "firefox",
  "edge",
  "brave",
  "chromium",
  "opera",
  "vivaldi",
  "whale",
] as const;
export type YtDlpCookiesBrowser = (typeof YT_DLP_COOKIE_BROWSERS)[number];

export interface SidebarPreferences {
  visibleItems: SidebarItem[];
  collapsed: boolean;
}

export interface AppearancePreferences {
  themeMode: ThemeMode;
  fontScale: FontScale;
  fontFamily?: "default" | "sans" | "mono" | "dyslexic";
  uiSize: UISize;
  showAnimations: AnimationSpeed;
  reducedMotion: boolean;
  showIcons: boolean;
  roundedCorners: boolean;
}

export interface PlayerPreferences {
  autoPlay: boolean;
  defaultSpeed: number;
  defaultVolume: number;
  showSubtitles: boolean;
  subtitleLanguage: string;
}

export interface LearningPreferences {
  pauseOnNewWord: boolean;
  highlightTranslations: boolean;
  autoSaveWords: boolean;
}

export interface DownloadPreferences {
  downloadQuality: DownloadQuality;
  cookiesFromBrowser: YtDlpCookiesBrowser;
}

export interface SyncPreferences {
  enabled: boolean;
  port: number;
}

export interface UserPreferences {
  sidebar: SidebarPreferences;
  appearance: AppearancePreferences;
  player: PlayerPreferences;
  learning: LearningPreferences;
  download: DownloadPreferences;
  sync: SyncPreferences;
  version: number;
  lastUpdated: number;
}

// Defaults
export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  visibleItems: [
    "home",
    "library",
    "dashboard",
    "channels",
    "playlists",
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
  ],
  collapsed: false,
};

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  themeMode: "light",
  fontScale: "normal",
  fontFamily: "default",
  uiSize: "comfortable",
  showAnimations: "normal",
  reducedMotion: false,
  showIcons: true,
  roundedCorners: true,
};

export const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  autoPlay: false,
  defaultSpeed: 1.0,
  defaultVolume: 70,
  showSubtitles: true,
  subtitleLanguage: "en",
};

export const DEFAULT_LEARNING_PREFERENCES: LearningPreferences = {
  pauseOnNewWord: false,
  highlightTranslations: true,
  autoSaveWords: true,
};

export const DEFAULT_DOWNLOAD_PREFERENCES: DownloadPreferences = {
  downloadQuality: "1080p", // Prefer Full HD by default; keep a 720p floor for smaller legacy presets
  cookiesFromBrowser: "none",
};

/**
 * Video downloads default to 1080p, but never go below 720p.
 * Users who want much smaller files should convert to audio instead.
 */
export const normalizeVideoDownloadQuality = (
  quality: DownloadQuality | null | undefined
): DownloadQuality => {
  if (quality === "1080p" || quality === null || quality === undefined) {
    return "1080p";
  }

  return "720p";
};

export const normalizeDownloadPreferences = (
  preferences: DownloadPreferences
): DownloadPreferences => ({
  ...preferences,
  downloadQuality: normalizeVideoDownloadQuality(preferences.downloadQuality),
});

export const DEFAULT_SYNC_PREFERENCES: SyncPreferences = {
  enabled: false,
  port: 53318,
};

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  sidebar: DEFAULT_SIDEBAR_PREFERENCES,
  appearance: DEFAULT_APPEARANCE_PREFERENCES,
  player: DEFAULT_PLAYER_PREFERENCES,
  learning: DEFAULT_LEARNING_PREFERENCES,
  download: normalizeDownloadPreferences(DEFAULT_DOWNLOAD_PREFERENCES),
  sync: DEFAULT_SYNC_PREFERENCES,
  version: 1,
  lastUpdated: Date.now(),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const parseNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const parseString = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const isSidebarItem = (value: unknown): value is SidebarItem =>
  typeof value === "string" &&
  [
    "home",
    "library",
    "dashboard",
    "channels",
    "playlists",
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
  ].includes(value);

const parseSidebarItems = (value: unknown, fallback: SidebarItem[]): SidebarItem[] =>
  Array.isArray(value)
    ? value.filter((item): item is SidebarItem => isSidebarItem(item))
    : fallback;

const parseEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  if (typeof value !== "string") {
    return fallback;
  }

  for (const candidate of allowed) {
    if (candidate === value) {
      return candidate;
    }
  }

  return fallback;
};

export const parseUserPreferences = (value: unknown): UserPreferences => {
  if (!isRecord(value)) {
    return DEFAULT_USER_PREFERENCES;
  }

  const sidebar = isRecord(value.sidebar) ? value.sidebar : {};
  const appearance = isRecord(value.appearance) ? value.appearance : {};
  const player = isRecord(value.player) ? value.player : {};
  const learning = isRecord(value.learning) ? value.learning : {};
  const download = isRecord(value.download) ? value.download : {};
  const sync = isRecord(value.sync) ? value.sync : {};

  const parsed: UserPreferences = {
    sidebar: {
      visibleItems: parseSidebarItems(
        sidebar.visibleItems,
        DEFAULT_USER_PREFERENCES.sidebar.visibleItems
      ),
      collapsed: parseBoolean(sidebar.collapsed, DEFAULT_USER_PREFERENCES.sidebar.collapsed),
    },
    appearance: {
      themeMode: parseEnum(
        appearance.themeMode,
        ["light", "dark"] as const,
        DEFAULT_USER_PREFERENCES.appearance.themeMode
      ),
      fontScale: parseEnum(
        appearance.fontScale,
        ["small", "normal", "large", "x-large"] as const,
        DEFAULT_USER_PREFERENCES.appearance.fontScale
      ),
      fontFamily: parseEnum(
        appearance.fontFamily,
        ["default", "sans", "mono", "dyslexic"] as const,
        DEFAULT_USER_PREFERENCES.appearance.fontFamily ?? "default"
      ),
      uiSize: parseEnum(
        appearance.uiSize,
        ["compact", "comfortable", "spacious"] as const,
        DEFAULT_USER_PREFERENCES.appearance.uiSize
      ),
      showAnimations: parseEnum(
        appearance.showAnimations,
        ["none", "reduced", "normal", "enhanced"] as const,
        DEFAULT_USER_PREFERENCES.appearance.showAnimations
      ),
      reducedMotion: parseBoolean(
        appearance.reducedMotion,
        DEFAULT_USER_PREFERENCES.appearance.reducedMotion
      ),
      showIcons: parseBoolean(appearance.showIcons, DEFAULT_USER_PREFERENCES.appearance.showIcons),
      roundedCorners: parseBoolean(
        appearance.roundedCorners,
        DEFAULT_USER_PREFERENCES.appearance.roundedCorners
      ),
    },
    player: {
      autoPlay: parseBoolean(player.autoPlay, DEFAULT_USER_PREFERENCES.player.autoPlay),
      defaultSpeed: parseNumber(player.defaultSpeed, DEFAULT_USER_PREFERENCES.player.defaultSpeed),
      defaultVolume: parseNumber(
        player.defaultVolume,
        DEFAULT_USER_PREFERENCES.player.defaultVolume
      ),
      showSubtitles: parseBoolean(
        player.showSubtitles,
        DEFAULT_USER_PREFERENCES.player.showSubtitles
      ),
      subtitleLanguage: parseString(
        player.subtitleLanguage,
        DEFAULT_USER_PREFERENCES.player.subtitleLanguage
      ),
    },
    learning: {
      pauseOnNewWord: parseBoolean(
        learning.pauseOnNewWord,
        DEFAULT_USER_PREFERENCES.learning.pauseOnNewWord
      ),
      highlightTranslations: parseBoolean(
        learning.highlightTranslations,
        DEFAULT_USER_PREFERENCES.learning.highlightTranslations
      ),
      autoSaveWords: parseBoolean(
        learning.autoSaveWords,
        DEFAULT_USER_PREFERENCES.learning.autoSaveWords
      ),
    },
    download: normalizeDownloadPreferences({
      downloadQuality: parseEnum(
        download.downloadQuality,
        ["360p", "480p", "720p", "1080p"] as const,
        DEFAULT_USER_PREFERENCES.download.downloadQuality
      ),
      cookiesFromBrowser: parseEnum(
        download.cookiesFromBrowser,
        YT_DLP_COOKIE_BROWSERS,
        DEFAULT_USER_PREFERENCES.download.cookiesFromBrowser
      ),
    }),
    sync: {
      enabled: parseBoolean(sync.enabled, DEFAULT_USER_PREFERENCES.sync.enabled),
      port: parseNumber(sync.port, DEFAULT_USER_PREFERENCES.sync.port),
    },
    version: parseNumber(value.version, DEFAULT_USER_PREFERENCES.version),
    lastUpdated: parseNumber(value.lastUpdated, DEFAULT_USER_PREFERENCES.lastUpdated),
  };

  return parsed;
};
