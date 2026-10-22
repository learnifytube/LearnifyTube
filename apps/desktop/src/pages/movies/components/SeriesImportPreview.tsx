import React from "react";
import { Input } from "@/components/ui/input";
import {
  moveEpisode,
  moveSeason,
  type ProposedEpisode,
  type SeriesImportPlan,
  type SeriesOrder,
} from "@/api/movies/series-plan";
import { formatListeningTime } from "@/pages/audiobooks/format";
import { CodecWarnings, MoveButtons, PreviewPoster } from "./ImportPreviewParts";

export const orderOfPlan = (plan: SeriesImportPlan): SeriesOrder =>
  plan.seasons.map((season) => ({
    key: season.key,
    episodes: season.episodes.map((episode) => episode.path),
  }));

// The Seasons and Episodes a Series Import would create, in an order the user can correct.
export function SeriesImportPreview({
  folderPath,
  plan,
  title,
  onTitleChange,
  order,
  onOrderChange,
}: {
  folderPath: string;
  plan: SeriesImportPlan;
  title: string;
  onTitleChange: (title: string) => void;
  order: SeriesOrder;
  onOrderChange: (order: SeriesOrder) => void;
}): React.JSX.Element {
  const episodesByPath = new Map<string, ProposedEpisode>(
    plan.seasons.flatMap((season) => season.episodes.map((episode) => [episode.path, episode]))
  );
  const seasonTitles = new Map(plan.seasons.map((season) => [season.key, season.title]));

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="w-20 shrink-0">
          <PreviewPoster
            folderPath={folderPath}
            poster={plan.poster}
            durationSeconds={plan.seasons[0]?.episodes[0]?.durationSeconds ?? null}
            title={title}
          />
        </div>
        <Input
          aria-label="Series title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </div>

      {order
        .filter((season) => season.episodes.length > 0)
        .map((season) => (
          <section key={season.key} className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-1.5">
              <h3 className="text-sm font-medium">{seasonTitles.get(season.key)}</h3>
              <MoveButtons
                label={seasonTitles.get(season.key) ?? "Season"}
                onMove={(by) => onOrderChange(moveSeason(order, season.key, by))}
              />
            </div>
            <ol className="divide-y">
              {season.episodes.map((path) => {
                const episode = episodesByPath.get(path);
                if (!episode) return null;
                return (
                  <li key={path} className="flex items-center gap-2 px-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm" title={path}>
                        {episode.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[path, formatListeningTime(episode.durationSeconds)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <CodecWarnings warnings={episode.codecWarnings} />
                    </div>
                    <MoveButtons
                      label={episode.title}
                      onMove={(by) => onOrderChange(moveEpisode(order, path, by))}
                    />
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
    </div>
  );
}
