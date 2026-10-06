import { useEffect, useState } from "react";
import { runMigrations } from "../db/migrate";
import { dropInlineItemThumbnails } from "../db/repositories/playlists";
import { getAppSurface } from "../core/hooks/useAppSurface";

export function useDatabase() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function init() {
      try {
        await runMigrations();
        // Before Home's first catalog read; the TV keeps its inline posters for Offline mode.
        if (getAppSurface() !== "tv") {
          await dropInlineItemThumbnails().catch((err) => {
            console.warn(
              "[useDatabase] Failed to drop inline thumbnails:",
              err,
            );
          });
        }
        setIsReady(true);
      } catch (err) {
        console.error("[useDatabase] Failed to initialize database:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }

    init();
  }, []);

  return { isReady, error };
}
