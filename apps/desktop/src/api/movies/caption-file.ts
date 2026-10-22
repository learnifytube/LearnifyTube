import { readFile } from "fs/promises";
import { parseCaptionCues, toWebVtt } from "../../../../shared/captions/captionCues";

// Older subtitle files are often Windows-1252 rather than UTF-8.
const decode = (bytes: Buffer): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
};

/** A sidecar .srt or .vtt file as plain WebVTT, the one form every player takes. */
export const readCaptionAsWebVtt = async (realPath: string): Promise<string> =>
  toWebVtt(parseCaptionCues(decode(await readFile(realPath))));
