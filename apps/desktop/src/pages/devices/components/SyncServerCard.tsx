import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Wifi } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SyncPairingCode } from "@/components/SyncPairingCode";

type SyncStatus = Awaited<ReturnType<typeof trpcClient.sync.getStatus.query>>;

// Turning the sync server on, and what a Device needs to pair with it.
export function SyncServerCard({ status }: { status: SyncStatus | undefined }): React.JSX.Element {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => trpcClient.sync.toggle.mutate(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sync", "status"] });
      if (result.success) {
        toast.success(result.enabled ? "Devices can connect" : "Devices can no longer connect", {
          description: result.enabled ? `Server running at ${result.ip}:${result.port}` : undefined,
        });
      } else {
        toast.error("Failed to toggle the sync server");
      }
    },
    onError: (error) => toast.error("Error", { description: String(error) }),
  });

  const address = status?.ip ? `http://${status.ip}:${status.port}` : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wifi className="h-5 w-5" />
          Pairing
        </CardTitle>
        <CardDescription>
          Devices on the same WiFi connect to this desktop. LearnifyTube keeps running in the tray.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label className="font-medium">Allow Devices to connect</Label>
          <Switch
            checked={status?.enabled ?? false}
            onCheckedChange={() => toggle.mutate()}
            disabled={toggle.isPending}
          />
        </div>
        {status?.enabled && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span
                className={`h-2 w-2 rounded-full ${status.running ? "animate-pulse bg-green-500" : "bg-yellow-500"}`}
              />
              {status.running ? "Server running" : "Starting..."}
            </div>
            <SyncPairingCode pairingCode={status.pairingCode} />
            {address && (
              <div>
                <Label className="text-xs text-muted-foreground">Address</Label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded bg-background px-3 py-2 font-mono text-sm">
                    {address}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Copy address"
                    onClick={() => {
                      navigator.clipboard.writeText(address);
                      toast.success("Address copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
