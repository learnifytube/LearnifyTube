import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, CircleDot, MoreVertical } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import type { WatchState } from "@/lib/watch-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BADGES = {
  unwatched: { label: "Unwatched", icon: Circle, className: "bg-black/60 text-white" },
  "in-progress": { label: "In progress", icon: CircleDot, className: "bg-blue-600/90 text-white" },
  watched: { label: "Watched", icon: CheckCircle2, className: "bg-green-600/90 text-white" },
} satisfies Record<WatchState, unknown>;

export function WatchStateBadge({
  watchState,
  className,
}: {
  watchState: WatchState;
  className?: string;
}): React.JSX.Element {
  const badge = BADGES[watchState];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
        badge.className,
        className
      )}
    >
      <badge.icon className="h-3 w-3" />
      {badge.label}
    </span>
  );
}

export function WatchStateMenu({
  videoId,
  watchState,
}: {
  videoId: string;
  watchState: WatchState;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const setWatched = useMutation({
    mutationFn: (watched: boolean) => trpcClient.watchStats.setWatched.mutate({ videoId, watched }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          aria-label="Video actions"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {watchState !== "watched" && (
          <DropdownMenuItem onClick={() => setWatched.mutate(true)}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Mark as watched
          </DropdownMenuItem>
        )}
        {watchState !== "unwatched" && (
          <DropdownMenuItem onClick={() => setWatched.mutate(false)}>
            <Circle className="mr-2 h-4 w-4" />
            Mark as unwatched
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
