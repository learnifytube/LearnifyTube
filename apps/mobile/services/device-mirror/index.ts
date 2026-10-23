import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api";
import { desktopProtocol } from "../desktop-protocol";
import { useSeriesLastEpisodesStore } from "../../stores/seriesLastEpisodes";
import { downloadQueue } from "../download-queue";
import { videoThumbnails } from "../video-thumbnails";
import { getAppSurface } from "../../core/hooks/useAppSurface";
import { useConnectionStore } from "../../stores/connection";
import { useLibraryStore } from "../../stores/library";
import { useOnDeviceSetStore } from "../../stores/onDeviceSet";
import { useListeningPositionsStore } from "../../stores/listeningPositions";
import { useMovieWatchStore } from "../../stores/movieWatch";
import { useCurrentVideosStore } from "../../stores/currentVideos";
import { getWatchHistory } from "../../db/repositories/watchHistory";
import { audiobookMirror } from "../audiobook-mirror";
import { heldMovies } from "../held-movies";
import { movieMirror } from "../movie-mirror";
import { heldAudiobooks } from "../held-audiobooks";
import { refreshMovieCatalog } from "../movie-catalog";
import { listenToSyncEvents } from "../sync-events";
import {
  createDeviceMirror,
  type DeviceMirrorPlatform,
} from "./createDeviceMirror";

const DEVICE_ID_KEY = "learnify-device-id";
const MIRRORED_IDS_KEY = "learnify-mirrored-video-ids";
const WATCH_REPORT_LIMIT = 500;

const kind = getAppSurface() === "tv" ? "tv" : "phone";
const model =
  Platform.OS === "android"
    ? (Platform.constants as { Model?: string }).Model
    : undefined;

// Audiobooks are a phone feature; a TV mirrors and reports none.
const noAudiobooks: DeviceMirrorPlatform["audiobooks"] = {
  mirror: async () => {},
  heldIds: async () => [],
};

// Changes whenever a Movie or Episode's Offline copy arrives or goes.
const heldMoviesKey = () => {
  const { movieIds, episodeIds } = heldMovies.heldIds();
  return [...movieIds, ...episodeIds].sort().join(",");
};

// Changes whenever an Audiobook becomes wholly held on the phone or leaves it.
const completeHoldsKey = () =>
  [...heldAudiobooks.getHolds()]
    .filter(([, hold]) => hold.complete)
    .map(([id]) => id)
    .sort()
    .join(",");

const getDeviceId = async () => {
  const saved = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (saved) return saved;
  const id = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
};

const platform: DeviceMirrorPlatform = {
  getServerUrl: () => useConnectionStore.getState().serverUrl,
  isForeground: () => AppState.currentState === "active",
  isLibraryLoaded: () => useLibraryStore.getState().isLoaded,
  onConditionsChange: (listener) => {
    const appStateSubscription = AppState.addEventListener("change", listener);
    const unsubscribeConnection = useConnectionStore.subscribe(
      (state, previous) => {
        if (state.serverUrl !== previous.serverUrl) listener();
      },
    );
    const unsubscribeLibrary = useLibraryStore.subscribe(
      (state) => state.isLoaded,
      listener,
    );
    // Sync (and so report) when a book finishes arriving, so the desktop
    // shows which Devices hold it without waiting for the next interval.
    let heldKey = completeHoldsKey();
    const unsubscribeHolds = heldAudiobooks.subscribe(() => {
      const next = completeHoldsKey();
      if (next === heldKey) return;
      heldKey = next;
      listener();
    });
    // The same for a Movie arriving, so the desktop shows it held.
    let moviesKey = heldMoviesKey();
    const unsubscribeMovies = heldMovies.subscribe(() => {
      const next = heldMoviesKey();
      if (next === moviesKey) return;
      moviesKey = next;
      listener();
    });
    return () => {
      unsubscribeMovies();
      appStateSubscription.remove();
      unsubscribeConnection();
      unsubscribeLibrary();
      unsubscribeHolds();
    };
  },
  desktop: {
    getProtocolVersion: desktopProtocol.learn,
    getOnDeviceSet: async (serverUrl) =>
      (await api.getOnDeviceSet(serverUrl)).videos,
    report: (serverUrl, report) => api.reportDevice(serverUrl, report),
    listen: (serverUrl, handlers) =>
      listenToSyncEvents(api.getEventsUrl(serverUrl), handlers),
  },
  device: {
    getId: getDeviceId,
    name: model ?? (kind === "tv" ? "TV" : "Phone"),
    kind,
  },
  getLibraryVideoIds: () => useLibraryStore.getState().videos.map((v) => v.id),
  getQueuedVideoIds: () => downloadQueue.getQueue().map((d) => d.videoId),
  requestDownload: (video) => downloadQueue.request(video),
  cancelDownload: (videoId) => downloadQueue.cancel(videoId),
  removeFromLibrary: (videoId) =>
    useLibraryStore.getState().removeVideo(videoId),
  hasThumbnail: (videoId) => videoThumbnails.getUri(videoId) !== null,
  storeThumbnail: (serverUrl, video) =>
    videoThumbnails.store(serverUrl, video.id, video.thumbnailUrl),
  getWatchProgress: () =>
    getWatchHistory(WATCH_REPORT_LIMIT).flatMap((item) =>
      item.lastWatchedAt
        ? [
            {
              videoId: item.videoId,
              lastPositionSeconds: item.lastPositionSeconds,
              lastWatchedAt: item.lastWatchedAt,
            },
          ]
        : [],
    ),
  getListening: () =>
    Object.values(useListeningPositionsStore.getState().positions).flatMap(
      (listening) => (listening ? [listening] : []),
    ),
  getMovieWatch: () => Object.values(useMovieWatchStore.getState().progress),
  resume: {
    seriesLastEpisodes: () =>
      Object.values(useSeriesLastEpisodesStore.getState().lastEpisodes),
    currentVideos: () =>
      Object.values(useCurrentVideosStore.getState().currentVideos),
  },
  loadMirroredIds: async () => {
    const raw = await AsyncStorage.getItem(MIRRORED_IDS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  },
  saveMirroredIds: (videoIds) =>
    AsyncStorage.setItem(MIRRORED_IDS_KEY, JSON.stringify(videoIds)),
  saveOnDeviceSet: (videos) => useOnDeviceSetStore.setState({ videos }),
  audiobooks: kind === "tv" ? noAudiobooks : audiobookMirror,
  // Phone and TV both Mirror the Movies and Seasons sent to Devices (ADR-0005).
  movies: { refreshCatalog: refreshMovieCatalog, ...movieMirror },
};

export const deviceMirror = createDeviceMirror(platform);
