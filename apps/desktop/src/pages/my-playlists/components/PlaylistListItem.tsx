import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FolderHeart, MoreVertical, Pencil, Trash2, Video } from "lucide-react";
import Thumbnail from "@/components/Thumbnail";
import { EditPlaylistDialog } from "@/components/playlists/EditPlaylistDialog";
import { DeleteCustomPlaylistDialog } from "@/components/playlists/DeleteCustomPlaylistDialog";
import { OnDevicesSwitch } from "@/components/OnDevicesSwitch";

type PlaylistListItemProps = {
  playlist: Awaited<ReturnType<typeof trpcClient.customPlaylists.listAll.query>>[number];
};

export function PlaylistListItem({ playlist }: PlaylistListItemProps): React.JSX.Element {
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const progress =
    playlist.itemCount && playlist.currentVideoIndex
      ? Math.round((playlist.currentVideoIndex / playlist.itemCount) * 100)
      : 0;

  return (
    <>
      <div className="group flex items-center gap-4 rounded-lg border p-3 transition-colors hover:bg-muted/50">
        {/* Main thumbnail */}
        <Link
          to="/playlist"
          search={{ playlistId: playlist.id, type: "custom" }}
          className="relative h-16 w-28 shrink-0 overflow-hidden rounded"
        >
          <Thumbnail
            thumbnailPath={playlist.thumbnailPath}
            thumbnailUrl={playlist.thumbnailUrl}
            alt={playlist.name}
            className="h-full w-full object-cover"
            fallbackIcon={<FolderHeart className="h-6 w-6 text-muted-foreground" />}
          />
          {progress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted">
              <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
          )}
        </Link>

        {/* Info */}
        <Link
          to="/playlist"
          search={{ playlistId: playlist.id, type: "custom" }}
          className="min-w-0 flex-1"
        >
          <h3 className="truncate font-medium">{playlist.name}</h3>
          <p className="text-sm text-muted-foreground">
            {playlist.itemCount ?? 0} videos
            {progress > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {progress}%
              </Badge>
            )}
          </p>
        </Link>

        {/* Preview thumbnails */}
        <div className="hidden items-center gap-1 sm:flex">
          {playlist.previewThumbnails.slice(0, 3).map((thumb, idx) => (
            <div
              key={thumb.videoId}
              className="relative h-12 w-20 overflow-hidden rounded bg-muted"
              title={thumb.title}
            >
              <Thumbnail
                thumbnailPath={thumb.thumbnailPath}
                thumbnailUrl={thumb.thumbnailUrl}
                alt={thumb.title}
                className="h-full w-full object-cover"
                fallbackIcon={<Video className="h-4 w-4 text-muted-foreground" />}
              />
              {idx === 2 && (playlist.itemCount ?? 0) > 3 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-medium text-white">
                  +{(playlist.itemCount ?? 0) - 3}
                </div>
              )}
            </div>
          ))}
          {playlist.previewThumbnails.length === 0 && (
            <div className="flex h-12 w-20 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
              No videos
            </div>
          )}
        </div>

        <OnDevicesSwitch listId={playlist.id} listName={playlist.name} className="shrink-0" />

        {/* Actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
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
