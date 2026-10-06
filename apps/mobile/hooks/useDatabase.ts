import { useEffect, useState } from "react";
import { runMigrations } from "../db/migrate";
import { dropInlineThumbnails } from "../db/repositories/playlists";
import { storeHeldInlineThumbnails } from "../services/video-thumbnails";

export function useDatabase() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function init() {
      try {
        await runMigrations();
        // Before the first catalog and Library reads.
        await storeHeldInlineThumbnails()
          .then(dropInlineThumbnails)
          .catch((err) => {
            console.warn(
              "[useDatabase] Failed to drop inline thumbnails:",
              err,
            );
          });
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
