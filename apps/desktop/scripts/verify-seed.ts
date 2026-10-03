#!/usr/bin/env tsx
/**
 * Fills a verify desktop's folder (LEARNIFYTUBE_USER_DATA_DIR) with a small,
 * deterministic library so the phone and TV have something to show: two
 * Channels, a playlist, a My List switched on for devices, six playable Videos
 * with thumbnails and transcripts, and one Video the desktop has not fetched.
 * Media is generated with ffmpeg; nothing touches the network or the user's
 * own desktop. Wipes and refills the folder on every run.
 *
 * Usage: npx tsx scripts/verify-seed.ts <dir>
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  channelPlaylists,
  channels,
  customPlaylistItems,
  customPlaylists,
  onDeviceLists,
  playlistItems,
  userPreferences,
  videoTranscripts,
  youtubeVideos,
} from "../src/api/db/schema";

export const VERIFY_SYNC_PORT = 53318;
export const VERIFY_PAIRING_CODE = "VERFY234";
const MARKER = ".verify-desktop";

const CHANNELS = [
  { channelId: "UCverifyScience01", title: "Little Science Lab", hue: 200 },
  { channelId: "UCverifyStories02", title: "Calm Bedtime Stories", hue: 30 },
];

const VIDEOS = [
  { videoId: "vrfyVideo01", channel: 0, seconds: 24, title: "Why is the sky blue?" },
  { videoId: "vrfyVideo02", channel: 0, seconds: 32, title: "Floating and sinking" },
  {
    videoId: "vrfyVideo03",
    channel: 0,
    seconds: 28,
    title:
      "A very long title about magnets, compasses and the invisible field around the Earth that keeps going",
  },
  { videoId: "vrfyVideo04", channel: 0, seconds: 20, title: "Rainbows" },
  { videoId: "vrfyVideo05", channel: 1, seconds: 36, title: "The sleepy owl" },
  { videoId: "vrfyVideo06", channel: 1, seconds: 40, title: "Moon and the fox" },
  // Never fetched: opening it asks the desktop to fetch from YouTube, which fails offline.
  {
    videoId: "vrfyVideo07",
    channel: 1,
    seconds: 30,
    title: "Not on the desktop yet",
    missing: true,
  },
];

const PLAYLIST = {
  playlistId: "PLverifyScience",
  channel: 0,
  title: "Science for kids",
  videos: ["vrfyVideo01", "vrfyVideo02", "vrfyVideo03", "vrfyVideo04"],
};

const MY_LIST = {
  id: "verify-bedtime",
  name: "Bedtime",
  videos: ["vrfyVideo05", "vrfyVideo06", "vrfyVideo07"],
};

const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);

const prepareFolder = (dir: string) => {
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir);
    if (entries.length > 0 && !entries.includes(MARKER)) {
      throw new Error(`${dir} is not empty and was not made by verify-seed; refusing to wipe it`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, MARKER), "");
};

const timestamp = (seconds: number) => {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `00:${mm}:${ss}.000`;
};

const transcriptFor = (title: string, seconds: number) => {
  const lines = [
    `Hello and welcome. Today we talk about ${title.toLowerCase()}.`,
    "Look closely and tell me what you notice.",
    "Every question is a good question.",
    "Let us try it together one more time.",
    "Thank you for watching, see you next time.",
  ];
  const step = Math.floor(seconds / lines.length);
  const segments = lines.map((text, i) => ({ start: i * step, end: (i + 1) * step, text }));
  const rawVtt = [
    "WEBVTT",
    "",
    ...segments.flatMap((s) => [`${timestamp(s.start)} --> ${timestamp(s.end)}`, s.text, ""]),
  ].join("\n");
  return { text: lines.join(" "), rawVtt, segmentsJson: JSON.stringify(segments) };
};

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error("Usage: npx tsx scripts/verify-seed.ts <dir>");
  const dir = path.resolve(target);
  prepareFolder(dir);

  const mediaDir = path.join(dir, "downloads", "LearnifyTube");
  const thumbDir = path.join(dir, "cache", "thumbnails");
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(thumbDir, { recursive: true });

  const client = createClient({ url: `file:${path.join(dir, "local.db")}` });
  const db = drizzle(client);
  await migrate(db, {
    migrationsFolder: path.resolve(path.dirname(process.argv[1]), "../drizzle"),
  });

  const now = Date.now();

  await db.insert(userPreferences).values({
    id: "default",
    customizationSettings: JSON.stringify({
      sync: { enabled: true, port: VERIFY_SYNC_PORT },
    }),
    createdAt: now,
  });

  for (const c of CHANNELS) {
    const thumbnailPath = path.join(thumbDir, `${c.channelId}.jpg`);
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `color=c=0x334155:s=256x256,hue=h=${c.hue}`,
      "-frames:v",
      "1",
      thumbnailPath,
    ]);
    await db.insert(channels).values({
      id: c.channelId,
      channelId: c.channelId,
      channelTitle: c.title,
      thumbnailPath,
      subscribedAt: now,
      createdAt: now,
    });
  }

  for (const [index, v] of VIDEOS.entries()) {
    const channel = CHANNELS[v.channel];
    const thumbnailPath = path.join(thumbDir, `${v.videoId}.jpg`);
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=1280x720,hue=h=${index * 50}`,
      "-frames:v",
      "1",
      thumbnailPath,
    ]);

    let downloadFilePath: string | null = null;
    if (!v.missing) {
      downloadFilePath = path.join(mediaDir, `${v.videoId}.mp4`);
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        `testsrc2=s=640x360:r=24,hue=h=${index * 50}`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${300 + index * 60}`,
        "-t",
        String(v.seconds),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        downloadFilePath,
      ]);
    }

    await db.insert(youtubeVideos).values({
      id: v.videoId,
      videoId: v.videoId,
      title: v.title,
      channelId: channel.channelId,
      channelTitle: channel.title,
      durationSeconds: v.seconds,
      thumbnailPath,
      publishedAt: now - index * 86_400_000,
      downloadStatus: v.missing ? null : "completed",
      downloadProgress: v.missing ? null : 100,
      downloadFilePath,
      downloadFileSize: downloadFilePath ? fs.statSync(downloadFilePath).size : null,
      lastDownloadedAt: v.missing ? null : now,
      keptAt: now,
      createdAt: now,
    });

    await db.insert(videoTranscripts).values({
      id: `${v.videoId}-en`,
      videoId: v.videoId,
      language: "en",
      source: "verify-seed",
      ...transcriptFor(v.title, v.seconds),
      createdAt: now,
    });
  }

  await db.insert(channelPlaylists).values({
    id: PLAYLIST.playlistId,
    playlistId: PLAYLIST.playlistId,
    channelId: CHANNELS[PLAYLIST.channel].channelId,
    title: PLAYLIST.title,
    itemCount: PLAYLIST.videos.length,
    createdAt: now,
  });
  await db.insert(playlistItems).values(
    PLAYLIST.videos.map((videoId, position) => ({
      id: `${PLAYLIST.playlistId}-${videoId}`,
      playlistId: PLAYLIST.playlistId,
      videoId,
      position,
      createdAt: now,
    }))
  );

  await db.insert(customPlaylists).values({
    id: MY_LIST.id,
    name: MY_LIST.name,
    itemCount: MY_LIST.videos.length,
    createdAt: now,
  });
  await db.insert(customPlaylistItems).values(
    MY_LIST.videos.map((videoId, position) => ({
      id: `${MY_LIST.id}-${videoId}`,
      playlistId: MY_LIST.id,
      videoId,
      position,
      addedAt: now,
      createdAt: now,
    }))
  );
  await db.insert(onDeviceLists).values({ listId: MY_LIST.id, createdAt: now });

  fs.writeFileSync(
    path.join(dir, "mobile-sync-pairing.json"),
    JSON.stringify({ code: VERIFY_PAIRING_CODE }),
    { mode: 0o600 }
  );

  client.close();
  console.log(`Seeded ${dir}: sync port ${VERIFY_SYNC_PORT}, pairing code ${VERIFY_PAIRING_CODE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
