import { parseCaptionCues } from "../../../shared/captions/captionCues";
import type { TranscriptSegment } from "../../types";

export type CaptionCuesSources = {
  /** A held title's Caption kept on this Device (`createKeptCaptions`), or null. */
  readKept(titleId: string, captionId: string): Promise<string | null>;
  /** GET /api/caption/:id: the Caption as WebVTT. */
  getCaption(serverUrl: string, captionId: string): Promise<string>;
};

/**
 * A Movie's or Episode's sidecar Captions as timed lines: the copy kept with a
 * held title first, so Captions show in Offline mode, else fetched from the
 * desktop once per Caption while the app runs. One that can't be read shows
 * nothing and is asked for again next time.
 */
export function createCaptionCues(sources: CaptionCuesSources) {
  const found = new Map<string, Promise<TranscriptSegment[]>>();

  const read = async (
    serverUrl: string | null,
    titleId: string,
    captionId: string,
  ): Promise<string | null> => {
    const kept = await sources.readKept(titleId, captionId);
    if (kept !== null) return kept;
    return serverUrl ? sources.getCaption(serverUrl, captionId) : null;
  };

  const load = (
    serverUrl: string | null,
    titleId: string,
    captionId: string,
  ): Promise<TranscriptSegment[]> => {
    const key = `${titleId}\n${captionId}`;
    const cached = found.get(key);
    if (cached) return cached;
    const loading = read(serverUrl, titleId, captionId)
      .then((text) => {
        if (text === null) {
          found.delete(key);
          return [];
        }
        return parseCaptionCues(text);
      })
      .catch((error: unknown) => {
        found.delete(key);
        console.warn("[captions] Couldn't fetch a Caption:", error);
        return [];
      });
    found.set(key, loading);
    return loading;
  };

  return { load };
}
