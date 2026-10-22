// Which parts of a video file Android is likely to refuse to play. Pure; the
// Import planner calls it for every Movie and Episode it proposes. Import only
// warns: nothing is transcoded.

export type CodecWarning = { part: "container" | "video" | "audio"; name: string };

export type ProbedVideo = {
  // The file's path; its extension names the container.
  path: string;
  videoCodec?: string | null;
  audioCodec?: string | null;
};

// By extension or ffmpeg codec name, with the name the preview shows.
const RISKY_CONTAINERS: Record<string, string> = { avi: "AVI", wmv: "WMV" };

const RISKY_VIDEO_CODECS: Record<string, string> = {
  wmv1: "WMV",
  wmv2: "WMV",
  wmv3: "WMV",
  vc1: "VC-1",
  msmpeg4v1: "MS-MPEG4",
  msmpeg4v2: "MS-MPEG4",
  msmpeg4v3: "MS-MPEG4",
  mpeg2video: "MPEG-2",
  rv30: "RealVideo",
  rv40: "RealVideo",
};

const RISKY_AUDIO_CODECS: Record<string, string> = {
  dts: "DTS",
  truehd: "Dolby TrueHD",
  mlp: "MLP",
  wmav1: "WMA",
  wmav2: "WMA",
  wmapro: "WMA",
  cook: "RealAudio",
};

const nameIn = (table: Record<string, string>, key: string | null | undefined): string | null =>
  key ? (table[key.toLowerCase()] ?? null) : null;

export const codecWarningsFor = (video: ProbedVideo): CodecWarning[] => {
  const container = nameIn(RISKY_CONTAINERS, video.path.split(".").pop());
  const videoCodec = nameIn(RISKY_VIDEO_CODECS, video.videoCodec);
  const audioCodec = nameIn(RISKY_AUDIO_CODECS, video.audioCodec);
  const warnings: CodecWarning[] = [];
  if (container) warnings.push({ part: "container", name: container });
  if (videoCodec) warnings.push({ part: "video", name: videoCodec });
  if (audioCodec) warnings.push({ part: "audio", name: audioCodec });
  return warnings;
};
