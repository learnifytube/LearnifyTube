import type { StreamingVideo } from "./playback";
import {
  historyKey,
  migrateTVHistory,
  recordPlayedQueue,
  recordPlayedTitle,
  recordQueueProgress,
  type TVHistoryEntry,
} from "./tvHistoryEntries";

const video = (id: string): StreamingVideo => ({
  id,
  title: `Video ${id}`,
  channelTitle: "Channel",
  duration: 60,
});

const queue = (playlistId: string, ids: string[], startIndex = 0) => ({
  playlistId,
  title: `Queue ${playlistId}`,
  videos: ids.map(video),
  startIndex,
});

describe("TV history entries", () => {
  it("puts a played Movie first", () => {
    const entries = recordPlayedTitle(
      recordPlayedQueue([], queue("q", ["a"]), 1),
      { kind: "movie", movieId: "m1", title: "The Matrix" },
      2,
    );

    expect(entries.map(historyKey)).toEqual(["movie:m1", "q"]);
    expect(entries[0]).toEqual({
      kind: "movie",
      movieId: "m1",
      title: "The Matrix",
      updatedAt: 2,
    });
  });

  it("keeps one entry per Movie, moved to the front when played again", () => {
    let entries: TVHistoryEntry[] = [];
    entries = recordPlayedTitle(
      entries,
      { kind: "movie", movieId: "m1", title: "Old title" },
      1,
    );
    entries = recordPlayedQueue(entries, queue("q", ["a"]), 2);
    entries = recordPlayedTitle(
      entries,
      { kind: "movie", movieId: "m1", title: "The Matrix" },
      3,
    );

    expect(entries.map(historyKey)).toEqual(["movie:m1", "q"]);
    expect(entries[0]).toMatchObject({ title: "The Matrix", updatedAt: 3 });
  });

  it("never mixes a Movie up with a queue of the same id", () => {
    const entries = recordPlayedTitle(
      recordPlayedQueue([], queue("m1", ["a"]), 1),
      { kind: "movie", movieId: "m1", title: "The Matrix" },
      2,
    );

    expect(entries).toHaveLength(2);
  });

  it("keeps the 20 most recent entries", () => {
    let entries: TVHistoryEntry[] = [];
    for (let index = 0; index < 25; index += 1) {
      entries = recordPlayedTitle(
        entries,
        { kind: "movie", movieId: `m${index}`, title: `Movie ${index}` },
        index,
      );
    }

    expect(entries).toHaveLength(20);
    expect(historyKey(entries[0])).toBe("movie:m24");
  });

  it("moves a queue's place without touching Movie entries", () => {
    const entries = recordQueueProgress(
      recordPlayedTitle(
        recordPlayedQueue([], queue("q", ["a", "b", "c"]), 1),
        { kind: "movie", movieId: "m1", title: "The Matrix" },
        2,
      ),
      { playlistId: "q", currentIndex: 2 },
      3,
    );

    expect(entries.map(historyKey)).toEqual(["q", "movie:m1"]);
    expect(entries[0]).toMatchObject({
      kind: "videos",
      lastIndex: 2,
      lastVideoId: "c",
    });
    expect(entries[1]).toMatchObject({ kind: "movie", updatedAt: 2 });
  });

  it("reads history saved before Movies as Video queues", () => {
    expect(
      migrateTVHistory({
        recentPlaylists: [
          {
            playlistId: "q",
            title: "Queue",
            videos: [{ ...video("a"), localPath: "file:///a.mp4" }],
            lastIndex: 0,
            lastVideoId: "a",
            updatedAt: 5,
            serverUrl: "http://old",
          },
        ],
      }),
    ).toEqual({
      entries: [
        {
          kind: "videos",
          playlistId: "q",
          title: "Queue",
          videos: [video("a")],
          lastIndex: 0,
          lastVideoId: "a",
          updatedAt: 5,
        },
      ],
    });
  });

  it("keeps one entry per Series, apart from a Movie of the same id", () => {
    let entries: TVHistoryEntry[] = [];
    entries = recordPlayedTitle(
      entries,
      { kind: "series", seriesId: "s1", title: "Old title" },
      1,
    );
    entries = recordPlayedTitle(
      entries,
      { kind: "movie", movieId: "s1", title: "A Movie" },
      2,
    );
    entries = recordPlayedTitle(
      entries,
      { kind: "series", seriesId: "s1", title: "Dark" },
      3,
    );

    expect(entries.map(historyKey)).toEqual(["series:s1", "movie:s1"]);
    expect(entries[0]).toEqual({
      kind: "series",
      seriesId: "s1",
      title: "Dark",
      updatedAt: 3,
    });
  });

  it("keeps a saved Series entry as a Series", () => {
    expect(
      migrateTVHistory({
        entries: [
          { kind: "series", seriesId: "s1", title: "Dark", updatedAt: 4 },
        ],
      }),
    ).toEqual({
      entries: [
        { kind: "series", seriesId: "s1", title: "Dark", updatedAt: 4 },
      ],
    });
  });

  it("starts empty from nothing saved", () => {
    expect(migrateTVHistory(undefined)).toEqual({ entries: [] });
  });
});
