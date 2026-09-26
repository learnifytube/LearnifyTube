import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { trpcClient } from "@/utils/trpc";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Smartphone, Wifi, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { SyncPairingCode } from "@/components/SyncPairingCode";

export function SyncTab(): React.JSX.Element {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: syncStatus, isLoading } = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => trpcClient.sync.getStatus.query(),
    refetchInterval: 5000, // Poll every 5 seconds to keep status up to date
  });

  const toggleMutation = useMutation({
    mutationFn: () => trpcClient.sync.toggle.mutate(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sync", "status"] });
      queryClient.invalidateQueries({ queryKey: ["preferences.customization"] });

      if (result.success) {
        toast({
          title: result.enabled ? "Mobile Sync Enabled" : "Mobile Sync Disabled",
          description: result.enabled
            ? `Server running at ${result.ip}:${result.port}`
            : "The mobile sync server has been stopped.",
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to toggle mobile sync.",
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: String(error),
        variant: "destructive",
      });
    },
  });

  const handleToggle = (): void => {
    toggleMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Loading sync status...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Mobile Sync
          </CardTitle>
          <CardDescription>
            Sync and stream your downloaded videos to the LearnifyTube mobile app over WiFi. Closing
            the window keeps LearnifyTube running in the tray.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="sync-toggle" className="text-base font-medium">
                Enable Mobile Sync
              </Label>
              <p className="text-sm text-muted-foreground">
                Allow mobile devices on your network to access videos. Sync stays on until you
                disable it or quit the app.
              </p>
            </div>
            <Switch
              id="sync-toggle"
              checked={syncStatus?.enabled ?? false}
              onCheckedChange={handleToggle}
              disabled={toggleMutation.isPending}
            />
          </div>

          {syncStatus?.enabled && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">Connection Details</span>
                <Badge variant={syncStatus.running ? "default" : "secondary"}>
                  {syncStatus.running ? "Running" : "Stopped"}
                </Badge>
              </div>

              <div className="grid gap-3">
                <SyncPairingCode pairingCode={syncStatus.pairingCode} />

                <div>
                  <Label className="text-xs text-muted-foreground">Server Address</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="rounded bg-muted px-3 py-2 font-mono text-lg font-bold">
                      {syncStatus.ip ?? "Not available"}
                    </code>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Port</Label>
                  <div className="mt-1">
                    <code className="rounded bg-muted px-3 py-2 font-mono text-lg font-bold">
                      {syncStatus.port}
                    </code>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Full URL</Label>
                  <div className="mt-1">
                    <code className="rounded bg-muted px-3 py-2 font-mono text-sm">
                      http://{syncStatus.ip}:{syncStatus.port}
                    </code>
                  </div>
                </div>
              </div>

              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                LearnifyTube stays running in the tray and asks the desktop to stay awake while
                Mobile Sync is enabled to reduce disconnects.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            How to Connect
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
            <li>Enable Mobile Sync above</li>
            <li>Make sure your mobile device is on the same WiFi network</li>
            <li>Open the LearnifyTube mobile app</li>
            <li>Tap "Connect to Desktop" on the mobile app</li>
            <li>Enter the pairing code shown above</li>
            <li>
              Enter the server address shown above (e.g.,{" "}
              <code className="rounded bg-muted px-1">{syncStatus?.ip ?? "192.168.x.x"}</code>)
            </li>
            <li>Your downloaded videos will appear on your mobile device</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
