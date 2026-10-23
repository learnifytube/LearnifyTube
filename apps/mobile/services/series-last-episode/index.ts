import { api } from "../api";
import { desktopProtocol } from "../desktop-protocol";
import { useConnectionStore } from "../../stores/connection";
import { useSeriesLastEpisodesStore } from "../../stores/seriesLastEpisodes";
import { createSeriesLastEpisodes } from "./createSeriesLastEpisodes";

export const seriesLastEpisodes = createSeriesLastEpisodes({
  now: () => Date.now(),
  keep: (entry) => useSeriesLastEpisodesStore.getState().keep(entry),
  getServerUrl: () => useConnectionStore.getState().serverUrl,
  knownDesktopVersion: desktopProtocol.known,
  post: (serverUrl, entry) => api.reportSeriesLastEpisode(serverUrl, entry),
});
