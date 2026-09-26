import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CirclePlay, ListVideo, Plus } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { isOnItsWay } from "@/lib/kept-video";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { QuickAddDialog } from "@/components/QuickAddDialog";
import { LibraryRowSection } from "./components/LibraryRowSection";
import { NewFromSubscriptionsSection } from "./components/NewFromSubscriptionsSection";
import { selectUpNext } from "./up-next";

// Up next: what to watch from the Library, and what to keep from Subscriptions
export default function HomePage(): React.JSX.Element {
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const libraryQuery = useQuery({
    queryKey: ["library", "list"],
    queryFn: () => trpcClient.library.list.query(),
    // Keep fetch progress fresh while any kept Video is still on its way
    refetchInterval: (query) =>
      query.state.data?.videos.some((v) => isOnItsWay(v.downloadStatus)) ? 2000 : false,
  });
  const { continueWatching, unwatched } = selectUpNext(libraryQuery.data?.videos ?? []);

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
            Up next
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Pick up where you left off.
          </p>
        </div>
        <Button onClick={() => setQuickAddOpen(true)} className="shrink-0 gap-2" size="lg">
          <Plus className="h-4 w-4" />
          Add URL
        </Button>
      </div>

      <LibraryRowSection
        title="Continue watching"
        icon={CirclePlay}
        videos={continueWatching}
        isLoading={libraryQuery.isLoading}
        emptyTitle="Nothing in progress"
        emptyHint="Videos you've started on any device show up here."
      />

      <LibraryRowSection
        title="Unwatched"
        icon={ListVideo}
        videos={unwatched.slice(0, 20)}
        isLoading={libraryQuery.isLoading}
        emptyTitle="All caught up"
        emptyHint="Add a URL or keep a Video from your Subscriptions."
      />

      <NewFromSubscriptionsSection />

      <QuickAddDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} />
    </PageContainer>
  );
}
