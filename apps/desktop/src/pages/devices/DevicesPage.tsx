import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Wifi, WifiOff } from "lucide-react";
import { trpcClient } from "@/utils/trpc";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { SyncServerCard } from "./components/SyncServerCard";
import { DeviceStatusCard } from "./components/DeviceStatusCard";
import { OnDeviceSetCard } from "./components/OnDeviceSetCard";

export default function DevicesPage(): React.JSX.Element {
  const statusQuery = useQuery({
    queryKey: ["sync", "status"],
    queryFn: () => trpcClient.sync.getStatus.query(),
    refetchInterval: 5000,
  });
  const running = statusQuery.data?.running ?? false;

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Devices</h1>
          <p className="text-sm text-muted-foreground">
            Your phone and TV hold the same Videos: the On-device set decided here on the desktop.
          </p>
        </div>
        <Badge variant={running ? "default" : "secondary"} className="h-8 gap-2 px-4 text-sm">
          {running ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          {running ? "Online" : "Offline"}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <SyncServerCard status={statusQuery.data} />
          <DeviceStatusCard />
        </div>
        <div className="lg:col-span-2">
          <OnDeviceSetCard />
        </div>
      </div>
    </PageContainer>
  );
}
