import { createRoute } from "@tanstack/react-router";
import { RootRoute } from "./__root";
import SettingsPage from "@/pages/settings-page/SettingsPage";
import HomePage from "@/pages/home/HomePage";
import DashboardPage from "@/pages/dashboard/DashboardPage";
import PlayerPage from "@/pages/player/PlayerPage";
import ChannelPage from "@/pages/channel/ChannelPage";
import ChannelsPage from "@/pages/channels/ChannelsPage";
import PlaylistPage from "@/pages/playlist/PlaylistPage";
import PlaylistsPage from "@/pages/playlists/PlaylistsPage";
import MyPlaylistsPage from "@/pages/my-playlists/MyPlaylistsPage";
import SubscriptionsPage from "@/pages/subscriptions/SubscriptionsPage";
import HistoryPage from "@/pages/history/HistoryPage";
import MyWordsPage from "@/pages/my-words/MyWordsPage";
import AnalyticsPage from "@/pages/analytics/AnalyticsPage";
import StorageManagerPage from "@/pages/storage/StorageManagerPage";
import MobileSyncPage from "@/pages/mobile-sync/MobileSyncPage";
import LogPage from "@/pages/app-debug-logs/index";
import LibraryPage from "@/pages/library/LibraryPage";
import { LEARNING_FEATURES_ENABLED } from "@/lib/features";

// Check if we're in development mode
// In Electron renderer, check window.location - if it's http(s)://, we're in dev mode
const isDevelopment = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  // If loading from http://localhost (dev server), we're in development
  const href = window.location.href;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return true;
  }

  // Fallback: check for Electron Forge dev server URL global
  // @ts-ignore - MAIN_WINDOW_VITE_DEV_SERVER_URL is a global defined by Electron Forge
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return true;
  }

  // Last fallback: if NODE_ENV is not explicitly production, assume development
  return process.env.NODE_ENV !== "production";
};

const HomeRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: HomePage,
});

const DownloadsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/downloads",
  component: DashboardPage,
});

const SettingsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/settings",
  component: SettingsPage,
});

const PlayerRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/player",
  component: PlayerPage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      videoId: typeof search.videoId === "string" ? search.videoId : undefined,
      playlistId: typeof search.playlistId === "string" ? search.playlistId : undefined,
      ...(typeof search.playlistUrl === "string" ? { playlistUrl: search.playlistUrl } : {}),
      playlistIndex: typeof search.playlistIndex === "number" ? search.playlistIndex : undefined,
    };
  },
});

const ChannelRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/channel",
  component: ChannelPage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      channelId: typeof search.channelId === "string" ? search.channelId : undefined,
    };
  },
});

const ChannelsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/channels",
  component: ChannelsPage,
});

const PlaylistRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/playlist",
  component: PlaylistPage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      playlistId: typeof search.playlistId === "string" ? search.playlistId : undefined,
      ...(typeof search.playlistUrl === "string" ? { playlistUrl: search.playlistUrl } : {}),
      type: search.type === "custom" ? ("custom" as const) : undefined,
    };
  },
});

const PlaylistsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/playlists",
  component: PlaylistsPage,
});

const MyPlaylistsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/my-playlists",
  component: MyPlaylistsPage,
});

const SubscriptionsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/subscriptions",
  component: SubscriptionsPage,
});

const HistoryRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/history",
  component: HistoryPage,
});

const MyWordsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/my-words",
  component: MyWordsPage,
});

const AnalyticsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/analytics",
  component: AnalyticsPage,
});

const LibraryRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/library",
  component: LibraryPage,
});

const StorageRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/storage",
  component: StorageManagerPage,
});

const MobileSyncRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/mobile-sync",
  component: MobileSyncPage,
});

const baseRoutes = [
  HomeRoute,
  DownloadsRoute,
  SettingsRoute,
  PlayerRoute,
  ChannelRoute,
  ChannelsRoute,
  PlaylistRoute,
  PlaylistsRoute,
  MyPlaylistsRoute,
  SubscriptionsRoute,
  HistoryRoute,
  ...(LEARNING_FEATURES_ENABLED ? [MyWordsRoute, AnalyticsRoute] : []),
  LibraryRoute,
  StorageRoute,
  MobileSyncRoute,
];

// Add log route only in development mode
const routes = isDevelopment()
  ? [
      ...baseRoutes,
      createRoute({
        getParentRoute: () => RootRoute,
        path: "/app-debug-logs",
        component: LogPage,
      }),
    ]
  : baseRoutes;

export const rootTree = RootRoute.addChildren(routes);
