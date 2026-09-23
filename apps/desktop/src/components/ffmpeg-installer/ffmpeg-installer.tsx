import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { logger } from "@/helpers/logger";
import { useSetAtom } from "jotai";
import { ffmpegStatusAtom } from "@/states/binary-status";

/**
 * FfmpegInstaller - Checks for ffmpeg availability on app startup.
 * Uses ffmpeg-static npm package (no download needed).
 */
export const FfmpegInstaller = (): null => {
  const setStatus = useSetAtom(ffmpegStatusAtom);

  // Query to check if ffmpeg is installed
  const {
    data: installInfo,
    isLoading: isCheckingInstall,
    isError: isCheckError,
  } = useQuery({
    queryKey: ["ffmpeg", "installInfo"],
    queryFn: () => trpcClient.binary.getFfmpegInstallInfo.query(),
    staleTime: Infinity, // Only check once per app session
    refetchOnWindowFocus: false,
  });

  // Log installation status
  useEffect(() => {
    if (isCheckError) {
      setStatus("error");
      return;
    }

    if (isCheckingInstall) {
      setStatus("checking");
      return;
    }

    if (installInfo?.installed) {
      logger.info("[FfmpegInstaller] ffmpeg available", {
        version: installInfo.version,
        path: installInfo.path,
        source: installInfo.path?.includes("node_modules")
          ? "ffmpeg-static npm package"
          : "userData/bin",
      });
      setStatus("ready");
    } else if (installInfo && !installInfo.installed) {
      logger.warn("[FfmpegInstaller] ffmpeg not found", {
        note: "ffmpeg-static npm package should be installed. Download fallback may not work reliably.",
      });
      setStatus("error");
    }
  }, [installInfo, isCheckingInstall, isCheckError, setStatus]);

  // This component doesn't render anything - it just handles the installation logic
  return null;
};
