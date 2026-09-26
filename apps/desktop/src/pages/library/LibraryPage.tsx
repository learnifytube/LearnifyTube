import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Library, Plus } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { isOnItsWay } from "@/lib/kept-video";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { QuickAddDialog } from "@/components/QuickAddDialog";
import { selectLibraryVideos, type LibraryView } from "./library-view";
import { LibraryToolbar, type LayoutMode } from "./components/LibraryToolbar";
import { LibraryVideoCard, LibraryVideoRow } from "./components/LibraryVideoItem";

const DEFAULT_VIEW: LibraryView = {
  search: "",
  sort: "recently-kept",
  watchState: "all",
  channelId: "all",
  listId: "all",
};

export default function LibraryPage(): React.JSX.Element {
  const [view, setView] = useState(DEFAULT_VIEW);
  const [layout, setLayout] = useState<LayoutMode>("grid");
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const libraryQuery = useQuery({
    queryKey: ["library", "list"],
    queryFn: () => trpcClient.library.list.query(),
    // Keep fetch progress fresh while any kept Video is still on its way
    refetchInterval: (query) =>
      query.state.data?.videos.some((v) => isOnItsWay(v.downloadStatus)) ? 2000 : false,
  });

  const allVideos = libraryQuery.data?.videos ?? [];
  const videos = selectLibraryVideos(allVideos, view);
  const channels = [
    ...new Map(
      allVideos
        .filter((v) => v.channelId)
        .map((v) => [
          v.channelId as string,
          { value: v.channelId as string, label: v.channelTitle },
        ])
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
  const lists = (libraryQuery.data?.lists ?? []).map((l) => ({ value: l.id, label: l.name }));

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Library</h1>
          <p className="text-sm text-muted-foreground">
            {libraryQuery.isLoading
              ? "Loading..."
              : `${videos.length} of ${allVideos.length} Videos`}
          </p>
        </div>
        <Button onClick={() => setQuickAddOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Add URL
        </Button>
      </div>

      <LibraryToolbar
        view={view}
        onViewChange={setView}
        layout={layout}
        onLayoutChange={setLayout}
        channels={channels}
        lists={lists}
      />

      {!libraryQuery.isLoading && videos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="rounded-full bg-muted p-4">
            <Library className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="font-medium">
            {allVideos.length === 0 ? "Your Library is empty" : "No Videos match these filters"}
          </p>
          <p className="text-sm text-muted-foreground">
            {allVideos.length === 0
              ? "Keep a Video from a Channel, a YouTube playlist, or a pasted URL."
              : "Try clearing the search or a filter."}
          </p>
        </div>
      ) : layout === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((video) => (
            <LibraryVideoCard key={video.videoId} video={video} />
          ))}
        </div>
      ) : (
        <div className="divide-y">
          {videos.map((video) => (
            <LibraryVideoRow key={video.videoId} video={video} />
          ))}
        </div>
      )}

      <QuickAddDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} />
    </PageContainer>
  );
}
