import { useEffect, useEffectEvent } from "react";
import type { Series } from "../../shared/mobile-sync-contract";
import { seriesEpisodeAfter } from "../services/movie-watch/seriesWatch";

/** What autoplay needs of the player: when it ends, and the loaded file's length. */
export type EndingPlayer = {
  readonly duration: number;
  addListener(event: "playToEnd", listener: () => void): { remove(): void };
};

/**
 * Episodes autoplay: when one ends, opens the next one in Series order that
 * can play, but only once a source is loaded. `series` is the Episodes the
 * player may go on to (null for a Movie); `open` navigates to that Episode.
 */
export function useEpisodeAutoplay(
  player: EndingPlayer,
  {
    series,
    id,
    hasSource,
    open,
  }: {
    series: Series | null;
    id: string;
    hasSource: boolean;
    open: (episodeId: string) => void;
  },
): void {
  // Reads the latest Series and id when the Episode ends, without resubscribing.
  const ended = useEffectEvent(() => {
    // Android reports a player with nothing loaded yet as ended.
    if (!series || !(player.duration > 0)) return;
    const next = seriesEpisodeAfter(series, id);
    if (next) open(next.id);
  });
  useEffect(() => {
    if (!hasSource) return;
    const subscription = player.addListener("playToEnd", () => ended());
    return () => subscription.remove();
  }, [player, hasSource]);
}
