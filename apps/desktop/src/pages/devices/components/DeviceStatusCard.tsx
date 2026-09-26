import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Smartphone, Tv } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatLastSeen } from "../format";

// Each Device as it last reported: when it was seen, and how much of the On-device set it holds.
export function DeviceStatusCard(): React.JSX.Element {
  const devicesQuery = useQuery({
    queryKey: ["onDevices", "devices"],
    queryFn: () => trpcClient.onDevices.getDevices.query(),
    refetchInterval: 10_000,
  });
  const devices = devicesQuery.data ?? [];
  const now = Date.now();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Devices</CardTitle>
        <CardDescription>
          Each Device fetches what is missing and removes what left the set whenever it connects.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {devices.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No Device has connected yet. Open LearnifyTube on your phone or TV and pair it.
          </p>
        ) : (
          <div className="space-y-2">
            {devices.map((device) => {
              const Icon = device.kind === "tv" ? Tv : Smartphone;
              return (
                <div key={device.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <p className="truncate font-medium">{device.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatLastSeen(device.lastSeenAt, now)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{device.present} present</Badge>
                      {device.missing > 0 && (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-600">
                          {device.missing} missing
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
