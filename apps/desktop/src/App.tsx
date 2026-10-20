import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import posthog from "posthog-js";

import "./localization/i18n";
import "@/styles/global.css";
import { updateAppLanguage } from "./helpers/language_helpers";
import { syncThemeWithLocal } from "./helpers/theme_helpers";
import { router } from "./routes/router";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/utils/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";

import { getConfig } from "./config/env";
import { useAppearancePreferences } from "./hooks/useAppearancePreferences";

import { YtDlpInstaller } from "@/components/ytdlp-installer";
import { FfmpegInstaller } from "@/components/ffmpeg-installer";
import { BinaryInitializationGuard } from "@/components/BinaryInitializationGuard";
import { AppUpdateChecker } from "@/components/version-checker";
import { getAppVersion } from "./helpers/version";
import { logger } from "./helpers/logger";
import DownloadFolderAccessInitializer from "@/components/DownloadFolderAccessInitializer";

// Initialize PostHog with enhanced CSP compatibility
posthog.init(getConfig("posthogKey"), {
  api_host: getConfig("posthogHost"),
  capture_pageview: false, // Disable automatic page views - we handle this in the router
  bootstrap: {
    isIdentifiedID: true,
  },
  property_blacklist: ["$password", "password", "secret"],
  // Disable features that might cause CSP issues
  disable_session_recording: true,

  disable_surveys: true, // Explicitly disable surveys
  autocapture: false,
  capture_pageleave: false,
  // Force debug off to prevent noisy console logs like "[PostHog.js] send \"$$heatmap\" ..."
  debug: false,
  loaded: (ph): void => {
    // Disable additional features that might attempt to inject scripts
    if (ph.config) {
      ph.config.disable_session_recording = true;

      ph.config.disable_surveys = true; // Explicitly disable surveys in config
      ph.config.autocapture = false;
    }

    // Ensure debug is fully disabled even if enabled via localStorage flags
    try {
      ph.debug(false);
      // Common localStorage flags that can enable PostHog debug mode
      window.localStorage.removeItem("posthog_debug");
      window.localStorage.removeItem("ph_debug");
    } catch {
      // no-op
    }
  },
});

// Set initial global properties
posthog.register({
  app_platform: "electron",

  environment: process.env.NODE_ENV || "production",
});

// Fetch the app version asynchronously and update PostHog
(async (): Promise<void> => {
  try {
    const appVersion = await getAppVersion();

    // Update the global property with the correct version
    posthog.register({ app_version: appVersion });
  } catch (error) {
    logger.error("Failed to get app version", error);
  }
})();

// Initialize theme based on saved preference
syncThemeWithLocal().catch((error) => logger.error("Failed to sync theme", error));

function MainApp(): React.JSX.Element {
  const { i18n } = useTranslation();

  // Apply appearance preferences
  useAppearancePreferences();

  useEffect(() => {
    updateAppLanguage(i18n);
  }, [i18n]);

  return <RouterProvider router={router} />;
}

function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppUpdateChecker />
        <YtDlpInstaller />
        <FfmpegInstaller />
        <BinaryInitializationGuard>
          <DownloadFolderAccessInitializer />
          <MainApp />
        </BinaryInitializationGuard>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const root = createRoot(document.getElementById("app")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
