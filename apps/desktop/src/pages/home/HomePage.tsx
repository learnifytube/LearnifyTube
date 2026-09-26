import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Play } from "lucide-react";
import { LEARNING_FEATURES_ENABLED } from "@/lib/features";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { QuickAddDialog } from "@/components/QuickAddDialog";
import { QuickStatsRow } from "./components/QuickStatsRow";
import { RecentDownloadsSection } from "./components/RecentDownloadsSection";
import { RecentPlaylistsSection } from "./components/RecentPlaylistsSection";

const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

export default function HomePage(): React.JSX.Element {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const navigate = useNavigate();

  // Fetch dashboard stats
  const statsQuery = useQuery({
    queryKey: ["learningStats", "dashboard"],
    queryFn: () => trpcClient.learningStats.getDashboardStats.query(),
    refetchOnWindowFocus: false,
  });

  // The Library, most recently kept first (includes Videos still on their way)
  const libraryQuery = useQuery({
    queryKey: ["library", "list"],
    queryFn: () => trpcClient.library.list.query(),
  });
  const recentlyKept = [...(libraryQuery.data?.videos ?? [])]
    .sort((a, b) => b.keptAt - a.keptAt)
    .slice(0, 10);

  // Fetch recent playlists
  const recentPlaylistsQuery = useQuery({
    queryKey: ["playlists", "listAll"],
    queryFn: () => trpcClient.playlists.listAll.query({ limit: 10 }),
    refetchOnWindowFocus: false,
  });

  const isLoading = statsQuery.isLoading;

  // Calculate retention rate (graduated / total learned)
  const retentionRate =
    statsQuery.data && statsQuery.data.flashcards.total > 0
      ? Math.round(
          ((statsQuery.data.flashcards.graduated + statsQuery.data.flashcards.learning) /
            statsQuery.data.flashcards.total) *
            100
        )
      : 0;

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            {getGreeting()}!
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Pick up where you left off.
          </p>
        </div>
        <div className="flex gap-2">
          {LEARNING_FEATURES_ENABLED && (
            <Button
              onClick={() => navigate({ to: "/my-words" })}
              variant="default"
              className="shrink-0 gap-2 bg-orange-500 hover:bg-orange-600"
              size="lg"
            >
              <Play className="h-4 w-4" />
              <span className="hidden sm:inline">Start Study Session</span>
              <span className="sm:hidden">Study</span>
            </Button>
          )}
          <Button
            onClick={() => setQuickAddOpen(true)}
            variant="outline"
            className="shrink-0 gap-2"
            size="lg"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add URL</span>
            <span className="sm:hidden">Add</span>
          </Button>
        </div>
      </div>

      {/* Quick Stats Row */}
      <QuickStatsRow
        totalWords={statsQuery.data?.flashcards.total ?? 0}
        retentionRate={retentionRate}
        weeklyMinutes={statsQuery.data?.watchTime.weekMinutes ?? 0}
        totalVideos={libraryQuery.data?.videos.length ?? 0}
        isLoading={isLoading || libraryQuery.isLoading}
      />

      {/* Recently kept */}
      <RecentDownloadsSection videos={recentlyKept} isLoading={libraryQuery.isLoading} />

      {/* Recent Playlists */}
      <RecentPlaylistsSection
        playlists={
          recentPlaylistsQuery.data?.map((p) => ({
            playlistId: p.playlistId,
            title: p.title,
            thumbnailUrl: p.thumbnailUrl,
            thumbnailPath: p.thumbnailPath,
            channelTitle: p.channelTitle,
            itemCount: p.itemCount,
            lastViewedAt: p.lastViewedAt,
          })) ?? []
        }
        isLoading={recentPlaylistsQuery.isLoading}
      />

      {/* Quick Add Dialog */}
      <QuickAddDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} />
    </PageContainer>
  );
}
