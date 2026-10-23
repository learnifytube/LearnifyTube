import React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { Badge } from "@/components/ui/badge";
import Thumbnail from "@/components/Thumbnail";
import { FavoriteButton } from "@/components/FavoriteButton";
import { Heart, Video, FolderHeart, ListVideo } from "lucide-react";
import { FAVORITES_LIST_ID } from "@/lib/lists";
import { FavoritesPlayButtons } from "./FavoritesPlayButtons";

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type ViewMode = "list" | "grid";

type FavoritesSectionProps = {
  viewMode: ViewMode;
  searchQuery: string;
};

export function FavoritesSection({
  viewMode,
  searchQuery,
}: FavoritesSectionProps): React.JSX.Element {
  const favoritesQuery = useQuery({
    queryKey: ["favorites", "listAll"],
    queryFn: () => trpcClient.favorites.listAll.query(),
    refetchOnWindowFocus: false,
  });

  const filteredFavorites = React.useMemo(() => {
    if (!favoritesQuery.data) return [];
    if (!searchQuery.trim()) return favoritesQuery.data;

    const query = searchQuery.toLowerCase();
    return favoritesQuery.data.filter((fav) => {
      if (fav.entityType === "video" && fav.video) {
        return (
          fav.video.title.toLowerCase().includes(query) ||
          fav.video.channelTitle?.toLowerCase().includes(query)
        );
      }
      if (fav.entityType === "custom_playlist" && fav.customPlaylist) {
        return (
          fav.customPlaylist.name.toLowerCase().includes(query) ||
          fav.customPlaylist.description?.toLowerCase().includes(query)
        );
      }
      if (fav.entityType === "channel_playlist" && fav.channelPlaylist) {
        return (
          fav.channelPlaylist.title.toLowerCase().includes(query) ||
          fav.channelPlaylist.description?.toLowerCase().includes(query)
        );
      }
      return false;
    });
  }, [favoritesQuery.data, searchQuery]);

  if (favoritesQuery.isLoading) {
    return <LoadingSkeleton viewMode={viewMode} />;
  }

  if (filteredFavorites.length === 0) {
    if (searchQuery) {
      return (
        <div className="py-8 text-center text-muted-foreground">
          No favorites found matching "{searchQuery}"
        </div>
      );
    }
    return <EmptyState />;
  }

  // Favorites' Videos newest first, the order Resume and "Play from start" follow.
  const firstVideoId =
    favoritesQuery.data?.find((fav) => fav.entityType === "video" && fav.video)?.entityId ?? null;

  return (
    <div className="space-y-4">
      <FavoritesPlayButtons firstVideoId={firstVideoId} />
      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredFavorites.map((fav) => (
            <FavoriteGridItem key={fav.favoriteId} favorite={fav} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredFavorites.map((fav) => (
            <FavoriteListItem key={fav.favoriteId} favorite={fav} />
          ))}
        </div>
      )}
    </div>
  );
}

type FavoriteItem = NonNullable<
  Awaited<ReturnType<typeof trpcClient.favorites.listAll.query>>[number]
>;

function FavoriteGridItem({ favorite }: { favorite: FavoriteItem }): React.JSX.Element {
  if (favorite.entityType === "video" && favorite.video) {
    return (
      <div className="group relative space-y-2 rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <Badge
          variant="secondary"
          className="absolute left-5 top-5 z-10 flex items-center gap-1 bg-background/90 text-xs backdrop-blur-sm"
        >
          <Video className="h-3 w-3" />
          Video
        </Badge>

        <FavoriteButton
          entityType="video"
          entityId={favorite.entityId}
          className="absolute right-5 top-5 z-10 h-8 w-8 bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
        />

        <Link
          to="/player"
          search={{
            videoId: favorite.video.videoId,
            // Favorites is a List: a Video started here becomes its Current Video.
            playlistId: FAVORITES_LIST_ID,
            playlistIndex: undefined,
          }}
          className="block"
        >
          <div className="relative">
            <Thumbnail
              thumbnailPath={favorite.video.thumbnailPath}
              thumbnailUrl={favorite.video.thumbnailUrl}
              alt={favorite.video.title}
              className="aspect-video w-full rounded object-cover"
              fallbackIcon={<Video className="h-12 w-12 text-muted-foreground" />}
            />
            {favorite.video.durationSeconds && (
              <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">
                {formatDuration(favorite.video.durationSeconds)}
              </div>
            )}
          </div>
          <div className="mt-2 space-y-1">
            <div className="line-clamp-2 text-sm font-medium">{favorite.video.title}</div>
            <div className="text-xs text-muted-foreground">{favorite.video.channelTitle}</div>
          </div>
        </Link>
      </div>
    );
  }

  if (favorite.entityType === "custom_playlist" && favorite.customPlaylist) {
    return (
      <div className="group relative space-y-2 rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <Badge
          variant="secondary"
          className="absolute left-5 top-5 z-10 flex items-center gap-1 bg-background/90 text-xs backdrop-blur-sm"
        >
          <FolderHeart className="h-3 w-3" />
          My Playlist
        </Badge>

        <FavoriteButton
          entityType="custom_playlist"
          entityId={favorite.entityId}
          className="absolute right-5 top-5 z-10 h-8 w-8 bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
        />

        <Link
          to="/playlist"
          search={{ playlistId: favorite.customPlaylist.id, type: "custom" }}
          className="block"
        >
          <div className="relative">
            <Thumbnail
              thumbnailPath={favorite.customPlaylist.thumbnailPath}
              thumbnailUrl={favorite.customPlaylist.thumbnailUrl}
              alt={favorite.customPlaylist.name}
              className="aspect-video w-full rounded object-cover"
              fallbackIcon={<FolderHeart className="h-12 w-12 text-muted-foreground" />}
            />
            {(favorite.customPlaylist.itemCount ?? 0) > 0 && (
              <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">
                {favorite.customPlaylist.itemCount} videos
              </div>
            )}
          </div>
          <div className="mt-2 space-y-1">
            <div className="line-clamp-2 text-sm font-medium">{favorite.customPlaylist.name}</div>
            {favorite.customPlaylist.description && (
              <div className="line-clamp-1 text-xs text-muted-foreground">
                {favorite.customPlaylist.description}
              </div>
            )}
          </div>
        </Link>
      </div>
    );
  }

  if (favorite.entityType === "channel_playlist" && favorite.channelPlaylist) {
    return (
      <div className="group relative space-y-2 rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <Badge
          variant="secondary"
          className="absolute left-5 top-5 z-10 flex items-center gap-1 bg-background/90 text-xs backdrop-blur-sm"
        >
          <ListVideo className="h-3 w-3" />
          YouTube Playlist
        </Badge>

        <FavoriteButton
          entityType="channel_playlist"
          entityId={favorite.entityId}
          className="absolute right-5 top-5 z-10 h-8 w-8 bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
        />

        <Link
          to="/playlist"
          search={{ playlistId: favorite.channelPlaylist.playlistId, type: undefined }}
          className="block"
        >
          <div className="relative">
            <Thumbnail
              thumbnailPath={favorite.channelPlaylist.thumbnailPath}
              thumbnailUrl={favorite.channelPlaylist.thumbnailUrl}
              alt={favorite.channelPlaylist.title}
              className="aspect-video w-full rounded object-cover"
              fallbackIcon={<ListVideo className="h-12 w-12 text-muted-foreground" />}
            />
            {(favorite.channelPlaylist.itemCount ?? 0) > 0 && (
              <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">
                {favorite.channelPlaylist.itemCount} videos
              </div>
            )}
          </div>
          <div className="mt-2 space-y-1">
            <div className="line-clamp-2 text-sm font-medium">{favorite.channelPlaylist.title}</div>
          </div>
        </Link>
      </div>
    );
  }

  return <></>;
}

function FavoriteListItem({ favorite }: { favorite: FavoriteItem }): React.JSX.Element {
  if (favorite.entityType === "video" && favorite.video) {
    return (
      <div className="group flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <Link
          to="/player"
          search={{
            videoId: favorite.video.videoId,
            // Favorites is a List: a Video started here becomes its Current Video.
            playlistId: FAVORITES_LIST_ID,
            playlistIndex: undefined,
          }}
          className="relative h-16 w-28 shrink-0 overflow-hidden rounded"
        >
          <Thumbnail
            thumbnailPath={favorite.video.thumbnailPath}
            thumbnailUrl={favorite.video.thumbnailUrl}
            alt={favorite.video.title}
            className="h-full w-full object-cover"
            fallbackIcon={<Video className="h-6 w-6 text-muted-foreground" />}
          />
          {favorite.video.durationSeconds && (
            <div className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-xs text-white">
              {formatDuration(favorite.video.durationSeconds)}
            </div>
          )}
        </Link>

        <Link
          to="/player"
          search={{
            videoId: favorite.video.videoId,
            // Favorites is a List: a Video started here becomes its Current Video.
            playlistId: FAVORITES_LIST_ID,
            playlistIndex: undefined,
          }}
          className="min-w-0 flex-1"
        >
          <h3 className="truncate font-medium">{favorite.video.title}</h3>
          <p className="text-sm text-muted-foreground">{favorite.video.channelTitle}</p>
        </Link>

        <Badge variant="outline" className="hidden sm:flex">
          <Video className="mr-1 h-3 w-3" />
          Video
        </Badge>

        <FavoriteButton
          entityType="video"
          entityId={favorite.entityId}
          className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
    );
  }

  if (favorite.entityType === "custom_playlist" && favorite.customPlaylist) {
    return (
      <div className="group flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <Link
          to="/playlist"
          search={{ playlistId: favorite.customPlaylist.id, type: "custom" }}
          className="relative h-16 w-28 shrink-0 overflow-hidden rounded"
        >
          <Thumbnail
            thumbnailPath={favorite.customPlaylist.thumbnailPath}
            thumbnailUrl={favorite.customPlaylist.thumbnailUrl}
            alt={favorite.customPlaylist.name}
            className="h-full w-full object-cover"
            fallbackIcon={<FolderHeart className="h-6 w-6 text-muted-foreground" />}
          />
        </Link>

        <Link
          to="/playlist"
          search={{ playlistId: favorite.customPlaylist.id, type: "custom" }}
          className="min-w-0 flex-1"
        >
          <h3 className="truncate font-medium">{favorite.customPlaylist.name}</h3>
          <p className="text-sm text-muted-foreground">
            {favorite.customPlaylist.itemCount ?? 0} videos
          </p>
        </Link>

        <Badge variant="outline" className="hidden sm:flex">
          <FolderHeart className="mr-1 h-3 w-3" />
          My Playlist
        </Badge>

        <FavoriteButton
          entityType="custom_playlist"
          entityId={favorite.entityId}
          className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
    );
  }

  if (favorite.entityType === "channel_playlist" && favorite.channelPlaylist) {
    return (
      <div className="group flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50">
        <Link
          to="/playlist"
          search={{ playlistId: favorite.channelPlaylist.playlistId, type: undefined }}
          className="relative h-16 w-28 shrink-0 overflow-hidden rounded"
        >
          <Thumbnail
            thumbnailPath={favorite.channelPlaylist.thumbnailPath}
            thumbnailUrl={favorite.channelPlaylist.thumbnailUrl}
            alt={favorite.channelPlaylist.title}
            className="h-full w-full object-cover"
            fallbackIcon={<ListVideo className="h-6 w-6 text-muted-foreground" />}
          />
        </Link>

        <Link
          to="/playlist"
          search={{ playlistId: favorite.channelPlaylist.playlistId, type: undefined }}
          className="min-w-0 flex-1"
        >
          <h3 className="truncate font-medium">{favorite.channelPlaylist.title}</h3>
          <p className="text-sm text-muted-foreground">
            {favorite.channelPlaylist.itemCount ?? 0} videos
          </p>
        </Link>

        <Badge variant="outline" className="hidden sm:flex">
          <ListVideo className="mr-1 h-3 w-3" />
          YouTube
        </Badge>

        <FavoriteButton
          entityType="channel_playlist"
          entityId={favorite.entityId}
          className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
    );
  }

  return <></>;
}

function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }): React.JSX.Element {
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <div className="aspect-video w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border p-3">
          <div className="h-16 w-28 animate-pulse rounded bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="py-8 text-center text-muted-foreground">
      <Heart className="mx-auto mb-2 h-12 w-12 text-muted-foreground/50" />
      <p>No favorites yet.</p>
      <p className="text-sm">Click the heart icon on any video or playlist to add it here.</p>
    </div>
  );
}
