import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { SentToDevicesPanel } from "./SentToDevicesPanel";

// Devices report what they hold when they sync, so this refreshes now and then.
const DEVICES_REFETCH_MS = 30_000;

/**
 * Send to Devices / Remove from Devices for one Season, and which Devices hold
 * it. A Series is sent a Season at a time, never whole.
 */
export function SeasonOnDevices({
  id,
  sentToDevices,
}: {
  id: string;
  sentToDevices: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const devicesQuery = useQuery({
    queryKey: ["movies", "series", "devicesHoldingSeason", id],
    queryFn: () => trpcClient.movies.series.devicesHoldingSeason.query({ id }),
    refetchInterval: DEVICES_REFETCH_MS,
  });

  const setSent = useMutation({
    mutationFn: (sent: boolean) =>
      trpcClient.movies.series.setSeasonSentToDevices.mutate({ id, sent }),
    onSuccess: async (_result, sent) => {
      await queryClient.invalidateQueries({ queryKey: ["movies"] });
      toast.success(
        sent
          ? "Sent to Devices. Each Device downloads the Season's Episodes, and ones a Rescan finds later."
          : "Removed from Devices at their next sync. Episodes downloaded on a phone by hand stay there."
      );
    },
    onError: () => toast.error("Couldn't change what Devices hold"),
  });

  return (
    <SentToDevicesPanel
      noun="Season"
      sentToDevices={sentToDevices}
      devices={devicesQuery.data ?? []}
      pending={setSent.isPending}
      onChange={(sent) => setSent.mutate(sent)}
    />
  );
}
