import Constants from "expo-constants";
import { Directory, File, Paths } from "expo-file-system";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Alert, Platform } from "react-native";
import { describeInstalledApp } from "./installed-app";
import { logger } from "./logger";

const DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 10_000;
const UPDATE_APK_FILE_NAME = "learnifytube-update.apk";
const APK_MIME_TYPE = "application/vnd.android.package-archive";
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FLAG_ACTIVITY_NEW_TASK = 268_435_456;
const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_ACCEPT_HEADER = "application/vnd.github+json";
const DEFAULT_GITHUB_RELEASE_SCAN_LIMIT = 12;
const INTENT_LAUNCHER_BUSY_RETRY_ATTEMPTS = 3;
const INTENT_LAUNCHER_BUSY_RETRY_DELAY_MS = 400;

interface ApkUpdateManifest {
  versionCode?: number;
  apkUrl: string;
  versionName?: string;
  releaseNotes?: string;
  forceUpdate?: boolean;
}

interface ApkUpdateConfig {
  manifestUrl?: string;
  githubRepo?: string;
  githubAssetName?: string;
  githubApiBaseUrl?: string;
  checkOnLaunch?: boolean;
  requestTimeoutMs?: number;
}

interface GithubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GithubReleaseResponse {
  tag_name?: string;
  name?: string;
  body?: string;
  assets?: GithubReleaseAsset[];
  draft?: boolean;
  prerelease?: boolean;
}

interface VersionComparisonResult {
  isNewer: boolean;
  summaryLines: string[];
}

/** Something the update check tells the user; the surface picks the wording. */
export type UpdateMessage =
  | { kind: "unavailable"; reason: string }
  | { kind: "notConfigured" }
  | { kind: "checkFailed"; error: unknown }
  | { kind: "cannotCompare" }
  | { kind: "upToDate" }
  | { kind: "downloading" }
  | { kind: "installerOpened" }
  | { kind: "failed"; error: unknown };

/** A yes/no the update check asks the user. */
export type UpdateQuestion =
  | {
      kind: "updateAvailable";
      versionLabel?: string;
      summaryLines: string[];
      releaseNotes?: string;
    }
  | { kind: "installBlocked" };

export interface UpdateMessenger {
  show: (message: UpdateMessage) => void;
  ask: (question: UpdateQuestion) => Promise<boolean>;
}

export interface AndroidApkUpdateAvailability {
  configured: boolean;
  hasUpdate: boolean;
  latestVersionLabel?: string;
  summaryLines?: string[];
}

const getSafeErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unknown error";
};

const parsePositiveInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
};

const normalizeVersionName = (value: string): string => {
  // Strip prefixes like "mobile-v", "desktop-v", or plain "v" before the semver digits.
  return value.trim().replace(/^(?:[a-z][\w]*-)?v?/i, "");
};

const parseSemver = (version: string): [number, number, number] | null => {
  const normalized = normalizeVersionName(version).split("+")[0].split("-")[0];
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareSemver = (left: string, right: string): number | null => {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);

  if (!leftParts || !rightParts) {
    return null;
  }

  for (let i = 0; i < leftParts.length; i += 1) {
    if (leftParts[i] > rightParts[i]) {
      return 1;
    }
    if (leftParts[i] < rightParts[i]) {
      return -1;
    }
  }

  return 0;
};

const extractVersionCodeFromText = (text: string | undefined): number | null => {
  if (!text) {
    return null;
  }

  const match = /(?:^|\n)\s*versionCode\s*[:=]\s*(\d+)\b/i.exec(text);
  return parsePositiveInt(match?.[1]);
};

const extractVersionCodeFromAssetName = (
  assetName: string | undefined
): number | null => {
  if (!assetName) {
    return null;
  }

  const match = /(?:^|[-_])vc(\d+)(?:[-_.]|$)/i.exec(assetName);
  return parsePositiveInt(match?.[1]);
};

const getUpdateConfig = (): ApkUpdateConfig => {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    apkUpdate?: ApkUpdateConfig;
  };
  return extra.apkUpdate ?? {};
};

/** The running build, read from the app config embedded at build time. */
export const getInstalledApp = () =>
  describeInstalledApp({
    os: Platform.OS,
    isDev: __DEV__,
    executionEnvironment: Constants.executionEnvironment,
    appConfig: Constants.expoConfig ?? null,
  });

const getAndroidApkUpdateUnsupportedReason = (): string | null => {
  const installed = getInstalledApp();
  return installed.canSelfUpdate ? null : installed.reason;
};

const canUseAndroidApkUpdates = (): boolean =>
  getAndroidApkUpdateUnsupportedReason() === null;

const askWithAlert = (
  title: string,
  message: string,
  primaryButtonText: string,
  cancelButtonText = "Cancel"
): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    Alert.alert(
      title,
      message,
      [
        {
          text: cancelButtonText,
          style: "cancel",
          onPress: () => finish(false),
        },
        {
          text: primaryButtonText,
          onPress: () => finish(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => finish(false),
      }
    );
  });

/** The phone's update prompts: system alerts. */
export const alertUpdateMessenger: UpdateMessenger = {
  show: (message) => {
    switch (message.kind) {
      case "unavailable":
        Alert.alert("Updates unavailable", message.reason);
        return;
      case "notConfigured":
        Alert.alert(
          "Updates not configured",
          "Set expo.extra.apkUpdate.manifestUrl or expo.extra.apkUpdate.githubRepo in app.json."
        );
        return;
      case "checkFailed":
        Alert.alert("Update check failed", getSafeErrorMessage(message.error));
        return;
      case "cannotCompare":
        Alert.alert(
          "Unable to compare versions",
          "Remote release is missing comparable version metadata."
        );
        return;
      case "upToDate":
        Alert.alert("You are up to date", "This build is already the latest.");
        return;
      case "downloading":
        Alert.alert(
          "Downloading update",
          "The APK is downloading now. Keep the app open until the installer appears."
        );
        return;
      case "installerOpened":
        Alert.alert(
          "Installer opened",
          "Tap Install in the Android installer to complete the update."
        );
        return;
      case "failed":
        Alert.alert("Update failed", getSafeErrorMessage(message.error));
        return;
    }
  },
  ask: (question) => {
    if (question.kind === "installBlocked") {
      return askWithAlert(
        "Update failed to start",
        "Enable 'Install unknown apps' for LearnifyTube, then retry update.",
        "Open Settings",
        "Close"
      );
    }
    const messageParts = [...question.summaryLines];
    if (question.releaseNotes) {
      messageParts.push("", question.releaseNotes);
    }
    return askWithAlert(
      question.versionLabel
        ? `Update ${question.versionLabel} available`
        : "Update available",
      messageParts.join("\n"),
      "Download"
    );
  },
};

const fetchWithTimeout = async (
  url: string,
  timeoutMs: number,
  options: RequestInit = {}
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchUpdateManifestFromUrl = async (
  manifestUrl: string,
  timeoutMs: number
): Promise<ApkUpdateManifest> => {
  const response = await fetchWithTimeout(manifestUrl, timeoutMs);
  if (!response.ok) {
    throw new Error(`Update manifest request failed (HTTP ${response.status}).`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const versionCode = parsePositiveInt(payload.versionCode);
  const apkUrl =
    typeof payload.apkUrl === "string" && payload.apkUrl.trim().length > 0
      ? payload.apkUrl.trim()
      : null;

  if (!versionCode) {
    throw new Error("Update manifest is missing a valid versionCode.");
  }

  if (!apkUrl) {
    throw new Error("Update manifest is missing a valid apkUrl.");
  }

  return {
    versionCode,
    apkUrl,
    versionName:
      typeof payload.versionName === "string"
        ? normalizeVersionName(payload.versionName)
        : undefined,
    releaseNotes:
      typeof payload.releaseNotes === "string" ? payload.releaseNotes : undefined,
    forceUpdate: payload.forceUpdate === true,
  };
};

const selectGithubApkAsset = (
  assets: GithubReleaseAsset[],
  preferredAssetName: string | undefined
): GithubReleaseAsset | null => {
  if (preferredAssetName) {
    const exact = assets.find((asset) => asset.name === preferredAssetName);
    if (exact?.browser_download_url) {
      return exact;
    }
  }

  const apkAsset = assets.find(
    (asset) =>
      typeof asset.name === "string" &&
      asset.name.toLowerCase().endsWith(".apk") &&
      typeof asset.browser_download_url === "string" &&
      asset.browser_download_url.trim().length > 0
  );

  return apkAsset ?? null;
};

const parseGithubReleaseManifest = (
  payload: GithubReleaseResponse,
  preferredAssetName: string | undefined
): ApkUpdateManifest | null => {
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const asset = selectGithubApkAsset(assets, preferredAssetName);

  if (!asset?.browser_download_url) {
    return null;
  }

  const versionNameCandidate =
    typeof payload.tag_name === "string" && payload.tag_name.trim().length > 0
      ? payload.tag_name
      : typeof payload.name === "string"
        ? payload.name
        : undefined;

  const versionCode =
    extractVersionCodeFromText(payload.body) ??
    extractVersionCodeFromAssetName(asset.name) ??
    undefined;

  return {
    versionCode,
    versionName: versionNameCandidate
      ? normalizeVersionName(versionNameCandidate)
      : undefined,
    apkUrl: asset.browser_download_url.trim(),
    releaseNotes: typeof payload.body === "string" ? payload.body : undefined,
  };
};

const fetchUpdateManifestFromGithubRelease = async (
  githubRepo: string,
  timeoutMs: number,
  options?: { assetName?: string; apiBaseUrl?: string }
): Promise<ApkUpdateManifest> => {
  if (!/^[^/\s]+\/[^/\s]+$/.test(githubRepo)) {
    throw new Error(
      `Invalid githubRepo '${githubRepo}'. Expected format: owner/repository.`
    );
  }

  const apiBaseUrl =
    options?.apiBaseUrl?.trim() || DEFAULT_GITHUB_API_BASE_URL;
  const endpoint = `${apiBaseUrl}/repos/${githubRepo}/releases/latest`;
  const response = await fetchWithTimeout(endpoint, timeoutMs, {
    headers: {
      Accept: GITHUB_API_ACCEPT_HEADER,
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub latest release request failed (HTTP ${response.status}).`
    );
  }

  const payload = (await response.json()) as GithubReleaseResponse;
  const latestManifest = parseGithubReleaseManifest(payload, options?.assetName);
  if (latestManifest) {
    return latestManifest;
  }

  const releasesEndpoint = `${apiBaseUrl}/repos/${githubRepo}/releases?per_page=${DEFAULT_GITHUB_RELEASE_SCAN_LIMIT}`;
  const releasesResponse = await fetchWithTimeout(releasesEndpoint, timeoutMs, {
    headers: {
      Accept: GITHUB_API_ACCEPT_HEADER,
    },
  });

  if (!releasesResponse.ok) {
    throw new Error(
      `GitHub releases request failed (HTTP ${releasesResponse.status}).`
    );
  }

  const releasesPayload = (await releasesResponse.json()) as GithubReleaseResponse[];
  const releases = Array.isArray(releasesPayload) ? releasesPayload : [];

  for (const release of releases) {
    if (release.draft || release.prerelease) {
      continue;
    }

    const manifest = parseGithubReleaseManifest(release, options?.assetName);
    if (manifest) {
      return manifest;
    }
  }

  if (options?.assetName) {
    throw new Error(
      `No APK asset named '${options.assetName}' found in recent GitHub releases.`
    );
  }
  throw new Error("No APK asset found in recent GitHub releases.");
};

const loadUpdateManifest = async (
  config: ApkUpdateConfig,
  timeoutMs: number
): Promise<ApkUpdateManifest> => {
  const manifestUrl = config.manifestUrl?.trim();
  if (manifestUrl) {
    return fetchUpdateManifestFromUrl(manifestUrl, timeoutMs);
  }

  const githubRepo = config.githubRepo?.trim();
  if (githubRepo) {
    return fetchUpdateManifestFromGithubRelease(githubRepo, timeoutMs, {
      assetName: config.githubAssetName?.trim(),
      apiBaseUrl: config.githubApiBaseUrl?.trim(),
    });
  }

  throw new Error("No update source configured.");
};

const compareRemoteVersion = (
  remote: ApkUpdateManifest,
  currentVersionCode: number | null,
  currentVersionName: string | null
): VersionComparisonResult | null => {
  if (remote.versionCode && currentVersionCode) {
    return {
      isNewer: remote.versionCode > currentVersionCode,
      summaryLines: [
        `Current build: ${currentVersionCode}`,
        `Latest build: ${remote.versionCode}`,
      ],
    };
  }

  if (remote.versionName && currentVersionName) {
    const semverResult = compareSemver(remote.versionName, currentVersionName);
    if (semverResult !== null) {
      return {
        isNewer: semverResult > 0,
        summaryLines: [
          `Current version: ${currentVersionName}`,
          `Latest version: ${remote.versionName}`,
        ],
      };
    }
  }

  return null;
};

const getUpdateFileUri = (): string => {
  const updatesDir = new Directory(Paths.cache, "updates");
  if (!updatesDir.exists) {
    updatesDir.create();
  }

  const updateFile = new File(updatesDir, UPDATE_APK_FILE_NAME);
  if (updateFile.exists) {
    updateFile.delete();
  }

  return updateFile.uri;
};

const downloadUpdateApk = async (apkUrl: string): Promise<string> => {
  const destinationUri = getUpdateFileUri();
  const downloadResumable = FileSystemLegacy.createDownloadResumable(
    apkUrl,
    destinationUri
  );
  const result = await downloadResumable.downloadAsync();

  if (!result || !result.uri || result.status < 200 || result.status >= 300) {
    throw new Error(
      `Failed to download APK update (HTTP ${result?.status ?? "unknown"}).`
    );
  }

  return result.uri;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isIntentLauncherBusyError = (error: unknown): boolean => {
  return getSafeErrorMessage(error).toLowerCase().includes(
    "activity is already started"
  );
};

const startIntentActivityWithRetry = async (
  activityAction: IntentLauncher.ActivityAction | string,
  params?: IntentLauncher.IntentLauncherParams
): Promise<void> => {
  for (let attempt = 1; attempt <= INTENT_LAUNCHER_BUSY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await IntentLauncher.startActivityAsync(activityAction, params);
      return;
    } catch (error) {
      const shouldRetry =
        isIntentLauncherBusyError(error) &&
        attempt < INTENT_LAUNCHER_BUSY_RETRY_ATTEMPTS;

      if (!shouldRetry) {
        throw error;
      }

      await sleep(INTENT_LAUNCHER_BUSY_RETRY_DELAY_MS);
    }
  }
};

const openUnknownSourcesSettings = async (): Promise<void> => {
  const packageName = Constants.expoConfig?.android?.package;
  if (!packageName) {
    throw new Error("Android package name is unavailable.");
  }

  await startIntentActivityWithRetry(
    IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
    {
      data: `package:${packageName}`,
    }
  );
};

const launchPackageInstaller = async (apkUri: string): Promise<void> => {
  const contentUri = await FileSystemLegacy.getContentUriAsync(apkUri);
  await startIntentActivityWithRetry("android.intent.action.VIEW", {
    data: contentUri,
    type: APK_MIME_TYPE,
    flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
  });
};

const getVersionLabel = (manifest: ApkUpdateManifest) =>
  manifest.versionName?.trim() ||
  (manifest.versionCode ? `build ${manifest.versionCode}` : undefined);

export const shouldCheckForUpdatesOnLaunch = (): boolean => {
  if (!canUseAndroidApkUpdates()) {
    return false;
  }

  const config = getUpdateConfig();
  return config.checkOnLaunch !== false;
};

export const getAndroidApkUpdateAvailability =
  async (): Promise<AndroidApkUpdateAvailability> => {
    if (!canUseAndroidApkUpdates()) {
      return { configured: false, hasUpdate: false };
    }

    const config = getUpdateConfig();
    const hasManifestUrl = !!config.manifestUrl?.trim();
    const hasGithubRepo = !!config.githubRepo?.trim();

    if (!hasManifestUrl && !hasGithubRepo) {
      return { configured: false, hasUpdate: false };
    }

    const timeoutMs =
      parsePositiveInt(config.requestTimeoutMs) ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;

    let manifest: ApkUpdateManifest;
    try {
      manifest = await loadUpdateManifest(config, timeoutMs);
    } catch (error) {
      logger.error("APK update availability check failed.", error, {
        manifestUrl: config.manifestUrl,
        githubRepo: config.githubRepo,
      });
      return { configured: true, hasUpdate: false };
    }

    const installed = getInstalledApp();
    const comparison = compareRemoteVersion(
      manifest,
      installed.versionCode ?? null,
      installed.versionName ? normalizeVersionName(installed.versionName) : null
    );

    if (!comparison) {
      return { configured: true, hasUpdate: false };
    }

    return {
      configured: true,
      hasUpdate: comparison.isNewer,
      latestVersionLabel: getVersionLabel(manifest),
      summaryLines: comparison.summaryLines,
    };
  };

export const checkForAndroidApkUpdate = async (options?: {
  manual?: boolean;
  messenger?: UpdateMessenger;
}) => {
  const messenger = options?.messenger ?? alertUpdateMessenger;
  const unsupportedReason = getAndroidApkUpdateUnsupportedReason();
  if (unsupportedReason) {
    if (options?.manual) {
      messenger.show({ kind: "unavailable", reason: unsupportedReason });
    }
    logger.debug("APK update check skipped.", { reason: unsupportedReason });
    return;
  }

  const config = getUpdateConfig();
  const hasManifestUrl = !!config.manifestUrl?.trim();
  const hasGithubRepo = !!config.githubRepo?.trim();

  if (!hasManifestUrl && !hasGithubRepo) {
    if (options?.manual) {
      messenger.show({ kind: "notConfigured" });
    }
    logger.debug("APK update check skipped: no update source is configured.");
    return;
  }

  const installed = getInstalledApp();
  const currentVersionCode = installed.versionCode ?? null;
  const currentVersionName = installed.versionName
    ? normalizeVersionName(installed.versionName)
    : null;

  const timeoutMs =
    parsePositiveInt(config.requestTimeoutMs) ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;

  let manifest: ApkUpdateManifest;
  try {
    manifest = await loadUpdateManifest(config, timeoutMs);
  } catch (error) {
    logger.error("APK update check failed.", error, {
      manifestUrl: config.manifestUrl,
      githubRepo: config.githubRepo,
    });
    if (options?.manual) {
      messenger.show({ kind: "checkFailed", error });
    }
    return;
  }

  const comparison = compareRemoteVersion(
    manifest,
    currentVersionCode,
    currentVersionName
  );

  if (!comparison) {
    logger.warn("APK update check skipped: unable to compare local and remote versions.", {
      currentVersionCode,
      currentVersionName,
      remoteVersionCode: manifest.versionCode,
      remoteVersionName: manifest.versionName,
    });
    if (options?.manual) {
      messenger.show({ kind: "cannotCompare" });
    }
    return;
  }

  if (!comparison.isNewer) {
    if (options?.manual) {
      messenger.show({ kind: "upToDate" });
    }
    return;
  }

  const shouldDownload = await messenger.ask({
    kind: "updateAvailable",
    versionLabel: getVersionLabel(manifest),
    summaryLines: comparison.summaryLines,
    releaseNotes: manifest.releaseNotes,
  });

  if (!shouldDownload) {
    return;
  }

  try {
    messenger.show({ kind: "downloading" });
    const apkUri = await downloadUpdateApk(manifest.apkUrl);
    await launchPackageInstaller(apkUri);
    messenger.show({ kind: "installerOpened" });
  } catch (error) {
    logger.error("APK update install flow failed.", error, {
      targetVersionCode: manifest.versionCode,
      apkUrl: manifest.apkUrl,
    });

    const openSettings = await messenger.ask({ kind: "installBlocked" });

    if (openSettings) {
      try {
        await openUnknownSourcesSettings();
      } catch (settingsError) {
        messenger.show({ kind: "failed", error: settingsError });
      }
      return;
    }

    messenger.show({ kind: "failed", error });
  }
};
