import { ExecutionEnvironment } from "expo-constants";

export interface InstalledAppEnvironment {
  os: string;
  isDev: boolean;
  executionEnvironment: ExecutionEnvironment;
  /** The app config embedded at build time (`Constants.expoConfig`). */
  appConfig: {
    version?: string;
    android?: { versionCode?: number };
  } | null;
}

export type InstalledApp =
  | { canSelfUpdate: true; versionName?: string; versionCode: number }
  | {
      canSelfUpdate: false;
      reason: string;
      versionName?: string;
      versionCode?: number;
    };

/**
 * Which LearnifyTube build is running, and whether it can install an App
 * update itself. The version comes from the embedded app config: expo-constants
 * no longer exposes nativeAppVersion / nativeBuildVersion.
 */
export function describeInstalledApp(env: InstalledAppEnvironment): InstalledApp {
  const versionName = env.appConfig?.version?.trim() || undefined;
  const rawVersionCode = env.appConfig?.android?.versionCode;
  const versionCode =
    typeof rawVersionCode === "number" &&
    Number.isInteger(rawVersionCode) &&
    rawVersionCode > 0
      ? rawVersionCode
      : undefined;

  const refuse = (reason: string): InstalledApp => ({
    canSelfUpdate: false,
    reason,
    versionName,
    versionCode,
  });

  if (env.os !== "android") {
    return refuse("APK self-update is only available on Android.");
  }
  if (env.isDev) {
    return refuse("APK self-update is unavailable in development builds.");
  }
  if (env.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return refuse(
      "APK self-update is unavailable in Expo Go or development clients."
    );
  }
  if (versionCode === undefined) {
    return refuse("APK self-update requires a build with a versionCode.");
  }

  return { canSelfUpdate: true, versionName, versionCode };
}
