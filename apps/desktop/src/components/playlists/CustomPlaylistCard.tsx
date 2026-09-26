import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Thumbnail from "@/components/Thumbnail";
import { EditPlaylistDialog } from "./EditPlaylistDialog";
import { DeleteCustomPlaylistDialog } from "./DeleteCustomPlaylistDialog";
import { FavoriteButton } from "@/components/FavoriteButton";
import { OnDevicesSwitch } from "@/components/OnDevicesSwitch";
import { MoreVertical, Pencil, Trash2, FolderHeart } from "lucide-react";

type CustomPlaylistCardProps = {
  playlist: {
    id: string;
    name: string;
    description?: string | null;
    itemCount?: number | null;
    viewCount?: number | null;
    currentVideoIndex?: number | null;
    totalWatchTimeSeconds?: number | null;
    thumbnailUrl?: string | null;
    thumbnailPath?: string | null;
    createdAt?: number | null;
    lastViewedAt?: number | null;
  };
  onPlaylistClick?: (playlistId: string) => void;
};

export function CustomPlaylistCard({
  playlist,
  onPlaylistClick,
}: CustomPlaylistCardProps): React.JSX.Element {
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleClick = (): void => {
    onPlaylistClick?.(playlist.id);
  };

  const hasWatchHistory = (playlist.viewCount ?? 0) > 0;
  const progress =
    playlist.itemCount && playlist.currentVideoIndex
      ? Math.round((playlist.currentVideoIndex / playlist.itemCount) * 100)
      : 0;

  return (
    <>
      <div className="group relative cursor-pointer space-y-2 rounded-lg border p-3 transition-colors hover:bg-muted/50">
        {/* Custom playlist badge */}
        <Badge
          variant="secondary"
          className="absolute left-5 top-5 z-10 flex items-center gap-1 bg-background/90 text-xs backdrop-blur-sm"
        >
          <FolderHeart className="h-3 w-3" />
          My Playlist
        </Badge>

        {/* Dropdown menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-5 top-5 z-10 h-8 w-8 bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
              onClick={(e) => e.preventDefault()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setShowDeleteDialog(true)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Favorite button */}
        <FavoriteButton
          entityType="custom_playlist"
          entityId={playlist.id}
          className="absolute right-14 top-5 z-10 h-8 w-8 bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
        />

        <Link
          to="/playlist"
          search={{ playlistId: playlist.id, type: "custom" }}
          onClick={handleClick}
          className="block"
        >
          {/* Thumbnail */}
          <div className="relative">
            <Thumbnail
              thumbnailPath={playlist.thumbnailPath}
              thumbnailUrl={playlist.thumbnailUrl}
              alt={playlist.name}
              className="aspect-video w-full rounded object-cover"
              fallbackIcon={<FolderHeart className="h-12 w-12 text-muted-foreground" />}
            />
            {(playlist.itemCount ?? 0) > 0 && (
              <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs text-white">
                {playlist.itemCount} videos
              </div>
            )}
            {progress > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden rounded-b bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>

          {/* Content */}
          <div className="mt-2 space-y-1">
            <div className="line-clamp-2 text-sm font-medium">{playlist.name}</div>
            {playlist.description && (
              <div className="line-clamp-1 text-xs text-muted-foreground">
                {playlist.description}
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex gap-2">
                {hasWatchHistory && progress > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {progress}%
                  </Badge>
                )}
              </div>
              {playlist.createdAt && (
                <span>{new Date(playlist.createdAt).toLocaleDateString()}</span>
              )}
            </div>
          </div>
        </Link>
        <OnDevicesSwitch listId={playlist.id} listName={playlist.name} />
      </div>

      <EditPlaylistDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        playlistId={playlist.id}
        initialName={playlist.name}
        initialDescription={playlist.description}
      />

      <DeleteCustomPlaylistDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        playlistId={playlist.id}
        playlistName={playlist.name}
        videoCount={playlist.itemCount}
      />
    </>
  );
}
