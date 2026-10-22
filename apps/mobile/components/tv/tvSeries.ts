import type { MovieWatch, Series } from "../../../shared/mobile-sync-contract";
import { seriesNextUp } from "../../services/movie-watch/seriesWatch";
import { describeTitleWatch } from "./tvCatalog";

export type TVEpisodeCard = {
  id: string;
  title: string;
  subtitle: string;
  /** A missing file can't play; its card shows but does nothing. */
  playable: boolean;
};

export type TVSeriesView = {
  seasons: Array<{ id: string; title: string; episodes: TVEpisodeCard[] }>;
  /** Where the screen opens: the next-up Episode, else the first that plays. */
  focus: { seasonIndex: number; episodeId: string } | null;
};

/** What the TV's Series screen shows: each Season's Episodes, and where it opens. */
export function buildTVSeriesView({
  series,
  keptEpisodeWatch,
}: {
  series: Series;
  keptEpisodeWatch: (episodeId: string) => MovieWatch | undefined;
}): TVSeriesView {
  const nextUpId = seriesNextUp(series, keptEpisodeWatch)?.episode.id ?? null;

  const seasons = series.seasons.map((season) => ({
    id: season.id,
    title: season.title,
    episodes: season.episodes.map<TVEpisodeCard>((episode) => {
      if (episode.missing) {
        return {
          id: episode.id,
          title: episode.title,
          subtitle: "File missing",
          playable: false,
        };
      }
      const watch = describeTitleWatch(episode, keptEpisodeWatch(episode.id));
      return {
        id: episode.id,
        title: episode.title,
        subtitle: episode.id === nextUpId ? `Up next · ${watch}` : watch,
        playable: true,
      };
    }),
  }));

  const find = (matches: (card: TVEpisodeCard) => boolean) => {
    for (const [seasonIndex, season] of seasons.entries()) {
      const card = season.episodes.find(matches);
      if (card) return { seasonIndex, episodeId: card.id };
    }
    return null;
  };

  return {
    seasons,
    focus:
      find((card) => card.id === nextUpId) ?? find((card) => card.playable),
  };
}
