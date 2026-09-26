import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  RefreshCw,
  Search,
  Plus,
  FolderHeart,
  LayoutGrid,
  LayoutList,
  Heart,
  Smartphone,
} from "lucide-react";
import { CustomPlaylistCard } from "@/components/playlists/CustomPlaylistCard";
import { CreatePlaylistDialog } from "@/components/playlists/CreatePlaylistDialog";
import { FavoritesSection } from "./components/FavoritesSection";
import { PlaylistListItem } from "./components/PlaylistListItem";
import { PhoneListSection } from "./components/PhoneListSection";
import { OnDevicesSwitch } from "@/components/OnDevicesSwitch";
import { FAVORITES_LIST_ID } from "@/lib/lists";

type ViewMode = "list" | "grid";

export default function MyPlaylistsPage(): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [activeTab, setActiveTab] = useState<"playlists" | "favorites" | "phone">("playlists");

  const customPlaylistsQuery = useQuery({
    queryKey: ["customPlaylists", "all"],
    queryFn: () => trpcClient.customPlaylists.listAll.query(),
    refetchOnWindowFocus: false,
  });

  const filteredPlaylists = useMemo(() => {
    if (!customPlaylistsQuery.data) return [];
    if (!searchQuery.trim()) return customPlaylistsQuery.data;

    const query = searchQuery.toLowerCase();
    return customPlaylistsQuery.data.filter(
      (playlist) =>
        playlist.name.toLowerCase().includes(query) ||
        playlist.description?.toLowerCase().includes(query)
    );
  }, [customPlaylistsQuery.data, searchQuery]);

  const handleRefresh = (): void => {
    customPlaylistsQuery.refetch();
  };

  const isLoading = customPlaylistsQuery.isLoading;
  const isRefetching = customPlaylistsQuery.isRefetching;

  return (
    <PageContainer>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold sm:text-3xl">My Lists</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={activeTab === "playlists" ? "Search lists..." : "Search videos..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 pl-9"
            />
          </div>
          {searchQuery && (
            <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
              Clear
            </Button>
          )}
          <div className="flex items-center rounded-md border">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-r-none"
              onClick={() => setViewMode("list")}
            >
              <LayoutList className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              className="rounded-l-none"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
          {activeTab === "playlists" && (
            <Button
              onClick={() => setShowCreateDialog(true)}
              size="sm"
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Create List
            </Button>
          )}
          <Button
            onClick={handleRefresh}
            disabled={isRefetching}
            size="sm"
            variant="outline"
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              if (value === "playlists" || value === "favorites" || value === "phone") {
                setActiveTab(value);
                setSearchQuery("");
              }
            }}
          >
            <TabsList>
              <TabsTrigger value="playlists" className="gap-2">
                <FolderHeart className="h-4 w-4" />
                My Playlists
                {filteredPlaylists.length > 0 && ` (${filteredPlaylists.length})`}
              </TabsTrigger>
              <TabsTrigger value="favorites" className="gap-2">
                <Heart className="h-4 w-4" />
                Favorites
              </TabsTrigger>
              <TabsTrigger value="phone" className="gap-2">
                <Smartphone className="h-4 w-4" />
                Phone List
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {activeTab === "playlists" ? (
            isLoading ? (
              <LoadingSkeleton viewMode={viewMode} />
            ) : filteredPlaylists.length > 0 ? (
              viewMode === "grid" ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredPlaylists.map((playlist) => (
                    <CustomPlaylistCard key={playlist.id} playlist={playlist} />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredPlaylists.map((playlist) => (
                    <PlaylistListItem key={playlist.id} playlist={playlist} />
                  ))}
                </div>
              )
            ) : searchQuery ? (
              <div className="py-8 text-center text-muted-foreground">
                No lists found matching "{searchQuery}"
              </div>
            ) : (
              <EmptyState onCreateClick={() => setShowCreateDialog(true)} />
            )
          ) : activeTab === "favorites" ? (
            <div className="space-y-4">
              <OnDevicesSwitch listId={FAVORITES_LIST_ID} listName="Favorites" />
              <FavoritesSection viewMode={viewMode} searchQuery={searchQuery} />
            </div>
          ) : (
            <PhoneListSection searchQuery={searchQuery} />
          )}
        </CardContent>
      </Card>

      <CreatePlaylistDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
    </PageContainer>
  );
}

function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }): React.JSX.Element {
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border p-3">
            <div className="aspect-video w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border p-3">
          <div className="h-16 w-28 animate-pulse rounded bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex gap-2">
            <div className="h-12 w-12 animate-pulse rounded bg-muted" />
            <div className="h-12 w-12 animate-pulse rounded bg-muted" />
            <div className="h-12 w-12 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }): React.JSX.Element {
  return (
    <div className="py-8 text-center text-muted-foreground">
      <FolderHeart className="mx-auto mb-2 h-12 w-12 text-muted-foreground/50" />
      <p>No lists yet.</p>
      <p className="text-sm">Create one to start organizing your videos.</p>
      <Button onClick={onCreateClick} className="mt-4 gap-2">
        <Plus className="h-4 w-4" />
        Create List
      </Button>
    </div>
  );
}
