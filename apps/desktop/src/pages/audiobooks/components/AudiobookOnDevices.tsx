import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone, Tv } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";

// Devices report what they hold when they sync, so this refreshes now and then.
const DEVICES_REFETCH_MS = 30_000;

/** Send to Devices / Remove from Devices for the whole Audiobook, and which Devices hold it. */
export function AudiobookOnDevices({
  id,
  sentToDevices,
}: {
  id: string;
  sentToDevices: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const devicesQuery = useQuery({
    queryKey: ["audiobooks", "devicesHolding", id],
    queryFn: () => trpcClient.audiobooks.devicesHolding.query({ id }),
    refetchInterval: DEVICES_REFETCH_MS,
  });
  const devices = devicesQuery.data ?? [];

  const setSent = useMutation({
    mutationFn: (sent: boolean) => trpcClient.audiobooks.setSentToDevices.mutate({ id, sent }),
    onSuccess: async (_result, sent) => {
      await queryClient.invalidateQueries({ queryKey: ["audiobooks"] });
      toast.success(
        sent
          ? "Sent to Devices. Each Device fetches the whole book."
          : "Removed from Devices at their next sync. Books played on a phone stay there."
      );
    },
    onError: () => toast.error("Couldn't change what Devices hold"),
  });

  return (
    <div className="mt-4 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant={sentToDevices ? "outline" : "default"}
          onClick={() => setSent.mutate(!sentToDevices)}
          disabled={setSent.isPending}
        >
          {sentToDevices ? "Remove from Devices" : "Send to Devices"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {sentToDevices
            ? "Sent: Devices fetch every Track and keep it offline."
            : "Not sent to Devices."}
        </span>
      </div>
      <p className="mt-3 text-xs font-semibold">On Devices</p>
      {devices.length === 0 ? (
        <p className="text-xs text-muted-foreground">No Device holds this book yet.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-2 text-sm">
              {device.kind === "tv" ? (
                <Tv className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Smartphone className="h-4 w-4 text-muted-foreground" />
              )}
              <span>{device.name}</span>
              <span className="text-xs text-muted-foreground">
                last seen {new Date(device.lastSeenAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
