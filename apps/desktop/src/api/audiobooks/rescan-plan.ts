// Rescan planner: compares an Audiobook's Track order with a fresh listing of
// its folder. Pure; reading the disk happens elsewhere.

import { compareTrackPaths, isAudioPath, type FolderListing } from "./import-plan";

export type CurrentTrack = {
  id: string;
  // Relative to the Audiobook's folder, "/"-separated.
  path: string;
  missing: boolean;
};

export type RescannedTrack =
  | { kind: "existing"; id: string; missing: boolean }
  | { kind: "new"; path: string; durationSeconds: number | null };

export type RescanPlan = { tracks: RescannedTrack[] };

// Existing Tracks keep their order; files no longer there are missing; new
// files join at the end in import order.
export const planRescan = (current: CurrentTrack[], listing: FolderListing): RescanPlan => {
  const audio = listing.files.filter((file) => isAudioPath(file.path));
  const present = new Set(audio.map((file) => file.path));
  const known = new Set(current.map((track) => track.path));
  const added = audio
    .filter((file) => !known.has(file.path))
    .sort((a, b) => compareTrackPaths(a.path, b.path));
  return {
    tracks: [
      ...current.map(
        (track): RescannedTrack => ({
          kind: "existing",
          id: track.id,
          missing: !present.has(track.path),
        })
      ),
      ...added.map(
        (file): RescannedTrack => ({
          kind: "new",
          path: file.path,
          durationSeconds: file.durationSeconds ?? null,
        })
      ),
    ],
  };
};
