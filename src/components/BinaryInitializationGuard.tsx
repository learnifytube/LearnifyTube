import React, { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { ytDlpStatusAtom, ffmpegStatusAtom } from "@/states/binary-status";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { logger } from "@/helpers/logger";

interface BinaryInitializationGuardProps {
  children: React.ReactNode;
}

export const BinaryInitializationGuard = ({
  children,
}: BinaryInitializationGuardProps): React.JSX.Element => {
  const ytDlpStatus = useAtomValue(ytDlpStatusAtom);
  const ffmpegStatus = useAtomValue(ffmpegStatusAtom);
  const [dismissed, setDismissed] = useState(false);

  const hasError = ytDlpStatus === "error" || ffmpegStatus === "error";

  useEffect(() => {
    if (!hasError) {
      setDismissed(false);
    }
  }, [hasError]);

  return (
    <>
      {children}

      {hasError && !dismissed ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-[min(420px,calc(100vw-2rem))]">
          <div className="pointer-events-auto rounded-lg border border-destructive/40 bg-background/95 p-4 shadow-lg backdrop-blur-sm">
            <div className="mb-3 flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Binary Initialization Issue</h2>
                <p className="text-xs text-muted-foreground">
                  Some download features may be unavailable, but you can keep using the app.
                </p>
              </div>
            </div>

            <div className="mb-3 space-y-1 rounded-md bg-muted/50 p-3 font-mono text-xs">
              <div className="flex justify-between">
                <span>yt-dlp:</span>
                <span className={ytDlpStatus === "error" ? "text-destructive" : "text-green-500"}>
                  {ytDlpStatus}
                </span>
              </div>
              <div className="flex justify-between">
                <span>ffmpeg:</span>
                <span className={ffmpegStatus === "error" ? "text-destructive" : "text-green-500"}>
                  {ffmpegStatus}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDismissed(true)}>
                Dismiss
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  logger.warn("User requested retry for binary initialization");
                  window.location.reload();
                }}
              >
                Retry
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
