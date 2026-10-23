import {
  RESUME_SYNC_PROTOCOL_VERSION,
  type SeriesLastEpisode,
} from "../../../shared/mobile-sync-contract";
import { createSeriesLastEpisodes } from "./createSeriesLastEpisodes";

const SERVER = "http://desktop.local:53318";

// Lets a live post finish.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function createHarness() {
  const state = {
    now: 1000,
    serverUrl: SERVER as string | null,
    // The desktop's protocol version as last learnt; null before it was.
    desktopVersion: RESUME_SYNC_PROTOCOL_VERSION as number | null,
    kept: [] as SeriesLastEpisode[],
    posted: [] as { serverUrl: string; entry: SeriesLastEpisode }[],
    postFails: false,
  };
  const lastEpisodes = createSeriesLastEpisodes({
    now: () => state.now,
    keep: (entry) => {
      state.kept.push(entry);
    },
    getServerUrl: () => state.serverUrl,
    knownDesktopVersion: () => state.desktopVersion,
    post: async (serverUrl, entry) => {
      if (state.postFails) throw new Error("HTTP 500");
      state.posted.push({ serverUrl, entry });
    },
  });
  return { state, lastEpisodes };
}

const started: SeriesLastEpisode = {
  seriesId: "office",
  episodeId: "s1e2",
  updatedAt: 1000,
};

describe("a Series' last Episode on a Device", () => {
  it("keeps the Episode started and sends it to the desktop at once", async () => {
    const { state, lastEpisodes } = createHarness();
    lastEpisodes.episodeStarted("office", "s1e2");
    await flush();
    expect(state.kept).toEqual([started]);
    expect(state.posted).toEqual([{ serverUrl: SERVER, entry: started }]);
  });

  it("only keeps it in Offline mode, for the next Device report", async () => {
    const { state, lastEpisodes } = createHarness();
    state.serverUrl = null;
    lastEpisodes.episodeStarted("office", "s1e2");
    await flush();
    expect(state.kept).toEqual([started]);
    expect(state.posted).toEqual([]);
  });

  it("sends nothing to a desktop older than resume, or one not yet asked", async () => {
    const { state, lastEpisodes } = createHarness();
    state.desktopVersion = RESUME_SYNC_PROTOCOL_VERSION - 1;
    lastEpisodes.episodeStarted("office", "s1e2");
    state.desktopVersion = null;
    lastEpisodes.episodeStarted("office", "s1e3");
    await flush();
    expect(state.kept).toHaveLength(2);
    expect(state.posted).toEqual([]);
  });

  it("still keeps it when the desktop refuses it", async () => {
    const { state, lastEpisodes } = createHarness();
    state.postFails = true;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    lastEpisodes.episodeStarted("office", "s1e2");
    await flush();
    expect(state.kept).toEqual([started]);
    warn.mockRestore();
  });
});
