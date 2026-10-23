import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpcClient } from "@/utils/trpc";
import { FAVORITES_LIST_ID } from "@/lib/lists";

const FAVORITES = { kind: "favorites", id: FAVORITES_LIST_ID } as const;

/**
 * Favorites is a List (ADR-0006): Resume plays where it picks up (its Current
 * Video, or the next unwatched one) and "Play from start" its newest Favorite.
 */
export function FavoritesPlayButtons({
  firstVideoId,
}: {
  /** The first Video in Favorites' order; null when Favorites holds no Video. */
  firstVideoId: string | null;
}): React.JSX.Element | null {
  const navigate = useNavigate();
  const pickUpQuery = useQuery({
    queryKey: ["collections", "pickUp", FAVORITES.kind, FAVORITES.id],
    queryFn: () => trpcClient.collections.pickUp.query(FAVORITES),
  });

  if (!firstVideoId) return null;

  const play = (videoId: string, index: number): void => {
    navigate({
      to: "/player",
      search: { videoId, playlistId: FAVORITES_LIST_ID, playlistIndex: index },
    });
  };

  const resume = async (): Promise<void> => {
    const pickUp = (await pickUpQuery.refetch()).data;
    if (pickUp) play(pickUp.videoId, pickUp.index);
    else play(firstVideoId, 0);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => void resume()} className="gap-2">
        <Play className="h-4 w-4" fill="currentColor" />
        Resume
      </Button>
      <Button variant="outline" onClick={() => play(firstVideoId, 0)} className="gap-2">
        <RotateCcw className="h-4 w-4" />
        Play from start
      </Button>
    </div>
  );
}
