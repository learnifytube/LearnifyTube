// A Video from a Channel's latest listing, with what Auto-keep needs to judge it.
export type LatestVideo = {
  videoId: string;
  publishedAt: number | null;
  isShort: boolean;
  liveStatus: string | null;
};

const AUTO_KEEP_LIMIT = 5;

// yt-dlp's publish times are approximate: to the hour for Videos under a day old, to the day
// after that. A Video dated up to a day before Auto-keep was switched on may be newer, so it
// still counts; the Videos listed when it was switched on are already considered.
const DATE_SLACK = 24 * 60 * 60 * 1000;

// yt-dlp's live_status for a live stream or premiere that has not finished airing
const NOT_AIRED = new Set(["is_upcoming", "is_live"]);

// Which of a Channel's latest Videos one Auto-keep check keeps (newest first), and which it
// now remembers as considered so it never looks at them again: the kept ones, and those
// skipped for being published before `since`, undated, Shorts or over the limit. With `since`
// at Infinity it keeps nothing and considers everything listed: the baseline taken when
// Auto-keep is switched on.
// A stream that has not aired yet is left alone, to be judged once it has.
export const selectAutoKeep = ({
  videos,
  since,
  considered,
  limit = AUTO_KEEP_LIMIT,
}: {
  videos: LatestVideo[];
  since: number;
  considered: ReadonlySet<string>;
  limit?: number;
}): { keep: string[]; markConsidered: string[] } => {
  const fresh = videos.filter(
    (v) => !considered.has(v.videoId) && !NOT_AIRED.has(v.liveStatus ?? "")
  );
  const eligible = fresh
    .filter((v) => !v.isShort && v.publishedAt !== null && v.publishedAt >= since - DATE_SLACK)
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  return {
    keep: eligible.slice(0, limit).map((v) => v.videoId),
    markConsidered: [...new Set(fresh.map((v) => v.videoId))],
  };
};
