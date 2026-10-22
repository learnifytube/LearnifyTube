import { parseCaptionCues } from "../../../shared/captions/captionCues";
import type { TranscriptSegment } from "../../types";

export type CaptionCuesDesktop = {
  /** GET /api/caption/:id: the Caption as WebVTT. */
  getCaption(serverUrl: string, captionId: string): Promise<string>;
};

/**
 * A Movie's or Episode's sidecar Captions as timed lines, fetched from the
 * desktop once per Caption while the app runs. One that can't be fetched
 * shows nothing and is asked for again next time.
 */
export function createCaptionCues(desktop: CaptionCuesDesktop) {
  const kept = new Map<string, Promise<TranscriptSegment[]>>();

  const load = (
    serverUrl: string,
    captionId: string,
  ): Promise<TranscriptSegment[]> => {
    const key = `${serverUrl}\n${captionId}`;
    const found = kept.get(key);
    if (found) return found;
    const loading = desktop
      .getCaption(serverUrl, captionId)
      .then(parseCaptionCues)
      .catch((error: unknown) => {
        kept.delete(key);
        console.warn("[captions] Couldn't fetch a Caption:", error);
        return [];
      });
    kept.set(key, loading);
    return loading;
  };

  return { load };
}
