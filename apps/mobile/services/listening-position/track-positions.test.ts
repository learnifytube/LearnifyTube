import type { Audiobook } from "../../../shared/mobile-sync-contract";
import { trackListenState, withKeptTrackPositions } from "./trackPositions";

const book: Audiobook = {
  id: "frankl",
  title: "Man's Search for Meaning",
  author: null,
  coverUrl: null,
  tracks: [
    {
      id: "cd1",
      title: "CD 1",
      durationSeconds: 300,
      missing: false,
      trackPosition: { seconds: 120, playedToEnd: false, updatedAt: 50 },
    },
    {
      id: "cd2",
      title: "CD 2",
      durationSeconds: 300,
      missing: false,
      trackPosition: { seconds: 40, playedToEnd: false, updatedAt: 90 },
    },
    { id: "cd3", title: "CD 3", durationSeconds: 300, missing: false },
  ],
  listeningPosition: null,
  finished: false,
  sentToDevices: true,
};

describe("Track positions on the phone", () => {
  it("takes the newest of the desktop's and the phone's Track position", () => {
    const merged = withKeptTrackPositions(book, {
      cd1: {
        audiobookId: "frankl",
        trackId: "cd1",
        seconds: 200,
        playedToEnd: false,
        updatedAt: 60,
      },
      cd2: {
        audiobookId: "frankl",
        trackId: "cd2",
        seconds: 10,
        playedToEnd: false,
        updatedAt: 80,
      },
      cd3: {
        audiobookId: "frankl",
        trackId: "cd3",
        seconds: 300,
        playedToEnd: true,
        updatedAt: 70,
      },
    });

    expect(merged.tracks.map((track) => track.trackPosition)).toEqual([
      { seconds: 200, playedToEnd: false, updatedAt: 60 },
      { seconds: 40, playedToEnd: false, updatedAt: 90 },
      { seconds: 300, playedToEnd: true, updatedAt: 70 },
    ]);
  });

  it("tells a Track not started, in progress or played to the end", () => {
    expect(trackListenState(null)).toBe("not-started");
    expect(
      trackListenState({ seconds: 0, playedToEnd: false, updatedAt: 1 }),
    ).toBe("not-started");
    expect(
      trackListenState({ seconds: 42, playedToEnd: false, updatedAt: 1 }),
    ).toBe("in-progress");
    expect(
      trackListenState({ seconds: 300, playedToEnd: true, updatedAt: 1 }),
    ).toBe("played-to-end");
  });
});
