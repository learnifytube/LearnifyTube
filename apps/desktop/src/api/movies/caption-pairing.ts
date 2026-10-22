// Sidecar Captions: subtitle files next to a video, named after it
// (`Up.srt`, `Up.en.srt`, `Up.pt-BR.forced.srt`). Pure, like the planners
// that use it.

export const CAPTION_EXTENSIONS = new Set(["srt", "vtt"]);

export type ProposedCaption = {
  // The subtitle file, relative to the picked folder, "/"-separated.
  path: string;
  // A language tag (`en`, `pt-BR`) read from the file name, if any.
  language: string | null;
  // What the language picker shows.
  label: string;
};

const FLAGS: Record<string, string> = { forced: "Forced", sdh: "SDH", cc: "CC" };
// Tags that say nothing about the Caption.
const IGNORED = new Set(["default"]);

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

// Language names as people write them in file names ("English", "french").
const NAMED_LANGUAGES = new Map(
  "ar cs da de el en es fi fr he hi hu id it ja ko nl no pl pt ro ru sv th tr uk vi zh"
    .split(" ")
    .map((code) => [languageNames.of(code)?.toLowerCase() ?? code, code])
);

const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,4})?$/i;

// The canonical tag (`eng` -> `en`, `pt-br` -> `pt-BR`) of a known language.
const languageOf = (tag: string): string | null => {
  const named = NAMED_LANGUAGES.get(tag.toLowerCase());
  if (named) return named;
  if (!LANGUAGE_TAG.test(tag)) return null;
  try {
    const [canonical] = Intl.getCanonicalLocales(tag);
    const name = languageNames.of(canonical);
    return name && name.toLowerCase() !== canonical.toLowerCase() && canonical !== "und"
      ? canonical
      : null;
  } catch {
    return null;
  }
};

const extensionOf = (path: string): string => path.split(".").pop()?.toLowerCase() ?? "";

const dirOf = (path: string): string => path.split("/").slice(0, -1).join("/");

const nameOf = (path: string): string => path.split("/").at(-1) ?? path;

export const isCaptionPath = (path: string): boolean => CAPTION_EXTENSIONS.has(extensionOf(path));

const describe = (path: string, tags: string[]): ProposedCaption => {
  let language: string | null = null;
  const flags: string[] = [];
  const other: string[] = [];
  for (const tag of tags) {
    const flag = FLAGS[tag.toLowerCase()];
    if (flag) flags.push(flag);
    else if (IGNORED.has(tag.toLowerCase())) continue;
    else if (language === null && languageOf(tag)) language = languageOf(tag);
    else other.push(tag);
  }
  const name = language
    ? (languageNames.of(language) ?? language)
    : other.length > 0
      ? other.join(" ")
      : "Captions";
  const label = flags.length > 0 ? `${name} (${flags.join(", ")})` : name;
  return { path, language, label };
};

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * The subtitle files among `paths` that belong to `videoPath`: in its folder,
 * named after it (in any case), with optional dot-separated tags for the
 * language and for forced or SDH Captions. By label.
 */
export const pairCaptions = (videoPath: string, paths: string[]): ProposedCaption[] => {
  const dir = dirOf(videoPath);
  const videoName = nameOf(videoPath);
  const base = videoName.slice(0, videoName.lastIndexOf(".")).toLowerCase();
  return paths
    .filter((path) => isCaptionPath(path) && dirOf(path) === dir)
    .flatMap((path) => {
      const name = nameOf(path);
      const stem = name.slice(0, name.lastIndexOf("."));
      if (stem.toLowerCase() === base) return [describe(path, [])];
      if (!stem.toLowerCase().startsWith(`${base}.`)) return [];
      return [describe(path, stem.slice(base.length + 1).split("."))];
    })
    .sort((a, b) => collator.compare(a.label, b.label) || collator.compare(a.path, b.path));
};
