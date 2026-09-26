import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PageContainer } from "@/components/ui/page-container";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { SyncPairingCode } from "@/components/SyncPairingCode";
import {
  Smartphone,
  Wifi,
  WifiOff,
  Video,
  HardDrive,
  Clock,
  CheckCircle2,
  Loader2,
  QrCode,
  Copy,
  RefreshCw,
} from "lucide-react";

interface VideoItem {
  videoId: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  downloadFileSize: number;
  thumbnailUrl?: string;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function MobileSyncPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());

  // Query sync status
  const { data: syncStatus, isLoading: syncLoading } = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => trpcClient.sync.getStatus.query(),
    refetchInterval: 5000,
  });

  // Query downloaded videos
  const { data: videosData, isLoading: videosLoading } = useQuery({
    queryKey: ["storage", "downloads"],
    queryFn: () => trpcClient.ytdlp.listDownloadedVideosDetailed.query(),
    refetchOnWindowFocus: false,
  });

  // Toggle sync mutation
  const toggleMutation = useMutation({
    mutationFn: () => trpcClient.sync.toggle.mutate(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sync", "status"] });
      if (result.success) {
        toast.success(result.enabled ? "Mobile Sync Enabled" : "Mobile Sync Disabled", {
          description: result.enabled
            ? `Server running at ${result.ip}:${result.port}`
            : "The mobile sync server has been stopped.",
        });
      } else {
        toast.error("Failed to toggle mobile sync");
      }
    },
    onError: (error) => {
      toast.error("Error", { description: String(error) });
    },
  });

  // Get videos list - only include videos where file exists on disk
  const videos: VideoItem[] = useMemo(() => {
    if (!videosData || !Array.isArray(videosData)) return [];
    return videosData
      .filter((v) => v.fileExists)
      .map((v) => ({
        videoId: v.videoId,
        title: v.title,
        channelTitle: v.channelTitle,
        durationSeconds: v.durationSeconds ?? 0,
        downloadFileSize: v.fileSizeBytes ?? 0,
        thumbnailUrl: v.thumbnailUrl ?? undefined,
      }));
  }, [videosData]);

  // Calculate stats
  const totalSize = useMemo(() => {
    return videos.reduce((acc, v) => acc + v.downloadFileSize, 0);
  }, [videos]);

  const selectedSize = useMemo(() => {
    return videos
      .filter((v) => selectedVideos.has(v.videoId))
      .reduce((acc, v) => acc + v.downloadFileSize, 0);
  }, [videos, selectedVideos]);

  const handleToggleVideo = (videoId: string): void => {
    setSelectedVideos((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  const handleSelectAll = (): void => {
    if (selectedVideos.size === videos.length) {
      setSelectedVideos(new Set());
    } else {
      setSelectedVideos(new Set(videos.map((v) => v.videoId)));
    }
  };

  const handleCopyAddress = (): void => {
    if (syncStatus?.ip) {
      navigator.clipboard.writeText(`http://${syncStatus.ip}:${syncStatus.port}`);
      toast.success("Address copied to clipboard");
    }
  };

  const _isLoading = syncLoading || videosLoading;

  return (
    <PageContainer>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Mobile Sync</h1>
            <p className="text-muted-foreground">
              Share your videos with the LearnifyTube mobile app. Closing the window keeps
              LearnifyTube running in the tray.
            </p>
          </div>
          <Badge
            variant={syncStatus?.running ? "default" : "secondary"}
            className="h-8 gap-2 px-4 text-sm"
          >
            {syncStatus?.running ? (
              <>
                <Wifi className="h-4 w-4" />
                Online
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4" />
                Offline
              </>
            )}
          </Badge>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Server Control Card */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                Server Status
              </CardTitle>
              <CardDescription>Control the mobile sync server</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base font-medium">Enable Server</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow mobile devices to connect. Sync stays on until you disable it or quit the
                    app.
                  </p>
                </div>
                <Switch
                  checked={syncStatus?.enabled ?? false}
                  onCheckedChange={() => toggleMutation.mutate()}
                  disabled={toggleMutation.isPending}
                />
              </div>

              {syncStatus?.enabled && (
                <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-2 w-2 rounded-full ${syncStatus.running ? "animate-pulse bg-green-500" : "bg-yellow-500"}`}
                    />
                    <span className="text-sm font-medium">
                      {syncStatus.running ? "Server Running" : "Starting..."}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <SyncPairingCode pairingCode={syncStatus.pairingCode} />

                    <div>
                      <Label className="text-xs text-muted-foreground">IP Address</Label>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="flex-1 rounded bg-background px-3 py-2 font-mono text-lg font-bold">
                          {syncStatus.ip ?? "N/A"}
                        </code>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground">Port</Label>
                      <code className="mt-1 block rounded bg-background px-3 py-2 font-mono text-lg font-bold">
                        {syncStatus.port}
                      </code>
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground">Full URL</Label>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="flex-1 truncate rounded bg-background px-3 py-2 font-mono text-sm">
                          http://{syncStatus.ip}:{syncStatus.port}
                        </code>
                        <Button size="icon" variant="outline" onClick={handleCopyAddress}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {syncStatus?.enabled && (
                <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  LearnifyTube stays running in the tray and asks the desktop to stay awake while
                  Mobile Sync is enabled to reduce disconnects.
                </p>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{videos.length}</div>
                  <div className="text-xs text-muted-foreground">Videos Available</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{formatBytes(totalSize)}</div>
                  <div className="text-xs text-muted-foreground">Total Size</div>
                </div>
              </div>

              {/* Discovered & Connected Devices */}
              {syncStatus?.enabled && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">
                    Mobile Devices (
                    {(syncStatus.discoveredDevices?.length ?? 0) +
                      (syncStatus.connectedDevices?.length ?? 0)}
                    )
                  </Label>
                  {(syncStatus.discoveredDevices?.length ?? 0) > 0 ||
                  (syncStatus.connectedDevices?.length ?? 0) > 0 ? (
                    <div className="space-y-2">
                      {/* Discovered devices via mDNS */}
                      {syncStatus.discoveredDevices?.map((device) => (
                        <div
                          key={device.name}
                          className="flex items-center justify-between rounded-lg border bg-background p-3"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10">
                              <Smartphone className="h-4 w-4 text-green-500" />
                            </div>
                            <div>
                              <div className="font-medium">{device.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {device.host} • {device.videoCount} videos
                              </div>
                            </div>
                          </div>
                          <Badge variant="outline" className="border-green-500/30 text-green-500">
                            Online
                          </Badge>
                        </div>
                      ))}
                      {/* Connected devices via HTTP (only show if not already in discovered) */}
                      {syncStatus.connectedDevices
                        ?.filter(
                          (device) =>
                            !syncStatus.discoveredDevices?.some((d) => d.host === device.ip)
                        )
                        .map((device) => (
                          <div
                            key={device.ip}
                            className="flex items-center justify-between rounded-lg border bg-background p-3"
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10">
                                <Smartphone className="h-4 w-4 text-blue-500" />
                              </div>
                              <div>
                                <div className="font-medium">{device.ip}</div>
                                <div className="text-xs text-muted-foreground">
                                  {device.requestCount} requests
                                </div>
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(device.lastSeen).toLocaleTimeString()}
                            </div>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                      No devices connected yet
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Videos List Card */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Video className="h-5 w-5" />
                    Available Videos
                  </CardTitle>
                  <CardDescription>
                    {selectedVideos.size > 0
                      ? `${selectedVideos.size} selected (${formatBytes(selectedSize)})`
                      : "All downloaded videos are available for sharing"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleSelectAll}>
                    {selectedVideos.size === videos.length ? "Deselect All" : "Select All"}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      queryClient.invalidateQueries({ queryKey: ["storage", "downloads"] })
                    }
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {videosLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : videos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <HardDrive className="h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium">No Videos Downloaded</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Download some videos first to share them with your mobile device
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[400px] pr-4">
                  <div className="space-y-2">
                    {videos.map((video) => (
                      <div
                        key={video.videoId}
                        className={`flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 ${
                          selectedVideos.has(video.videoId) ? "border-primary bg-primary/5" : ""
                        }`}
                      >
                        <Checkbox
                          checked={selectedVideos.has(video.videoId)}
                          onCheckedChange={() => handleToggleVideo(video.videoId)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{video.title}</div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{video.channelTitle}</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(video.durationSeconds)}
                            </span>
                            <span className="flex items-center gap-1">
                              <HardDrive className="h-3 w-3" />
                              {formatBytes(video.downloadFileSize)}
                            </span>
                          </div>
                        </div>
                        <CheckCircle2
                          className={`h-5 w-5 flex-shrink-0 ${
                            selectedVideos.has(video.videoId)
                              ? "text-primary"
                              : "text-muted-foreground/30"
                          }`}
                        />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Instructions Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              How to Connect
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-4">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  1
                </div>
                <h4 className="mt-3 font-medium">Enable Server</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Turn on the sync server using the toggle above
                </p>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  2
                </div>
                <h4 className="mt-3 font-medium">Same Network</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connect your phone to the same WiFi network
                </p>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  3
                </div>
                <h4 className="mt-3 font-medium">Open Mobile App</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Launch LearnifyTube on your mobile device
                </p>
              </div>
              <div className="flex flex-col items-center text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  4
                </div>
                <h4 className="mt-3 font-medium">Auto-Discover</h4>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your desktop will appear automatically, or enter the IP manually
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
