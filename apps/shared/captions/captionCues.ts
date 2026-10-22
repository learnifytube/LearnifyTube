// Sidecar Caption files (.srt and .vtt) as timed lines. The desktop serves
// every Caption as WebVTT; the phone and TV read it back into cues.

export type CaptionCue = { start: number; end: number; text: string };

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
const TIMING = new RegExp(`${TIME.source}\\s*-->\\s*${TIME.source}`);

const seconds = (
  hours: string | undefined,
  minutes: string,
  secs: string,
  ms: string,
): number =>
  Number(hours ?? 0) * 3600 +
  Number(minutes) * 60 +
  Number(secs) +
  Number(ms.padEnd(3, "0")) / 1000;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&quot;": '"',
  "&#39;": "'",
};

// Tags (<i>, <c.yellow>, <v Roger>, <font>) and SSA overrides ({\an8}) go.
const plainText = (line: string): string =>
  line
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")
    .replace(
      /&(amp|lt|gt|nbsp|quot|#39);/g,
      (entity) => ENTITIES[entity] ?? entity,
    )
    .trim();

export const parseCaptionCues = (text: string): CaptionCue[] => {
  const blocks = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/);
  const cues: CaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => TIMING.test(line));
    if (timingIndex < 0) continue;
    const match = TIMING.exec(lines[timingIndex]);
    if (!match) continue;
    const cueText = lines
      .slice(timingIndex + 1)
      .map(plainText)
      .filter(Boolean)
      .join("\n");
    if (!cueText) continue;
    cues.push({
      start: seconds(match[1], match[2], match[3], match[4]),
      end: seconds(match[5], match[6], match[7], match[8]),
      text: cueText,
    });
  }
  return cues;
};

const pad = (value: number, width = 2): string =>
  String(value).padStart(width, "0");

const vttTime = (time: number): string => {
  const ms = Math.round(time * 1000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const secs = Math.floor(ms / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(ms % 1000, 3)}`;
};

const escapeVtt = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Plain WebVTT, as Chromium's <track> takes it. */
export const toWebVtt = (cues: CaptionCue[]): string =>
  [
    "WEBVTT",
    ...cues.map(
      (cue) =>
        `${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${escapeVtt(cue.text)}`,
    ),
  ]
    .join("\n\n")
    .concat("\n");
