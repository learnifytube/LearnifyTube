import React, { useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Switch } from "@/components/ui/switch";

/**
 * Shown on Devices for a Movie or a whole Series. Off, phones and TVs no longer
 * list the title, and remove it if it was sent to them.
 */
export function ShownOnDevicesSwitch({
  kind,
  id,
  shown,
}: {
  kind: "movie" | "series";
  id: string;
  shown: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const switchId = useId();
  const setShown = useMutation({
    mutationFn: (next: boolean) =>
      trpcClient.movies.setShownOnDevices.mutate({ kind, id, shown: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["movies"] }),
    onError: () => toast.error("Couldn't change Shown on Devices"),
  });
  // Shows the new value while it saves.
  const checked = setShown.isPending ? (setShown.variables ?? shown) : shown;

  return (
    <div className="flex items-center gap-2 text-sm">
      <Switch
        id={switchId}
        checked={checked}
        disabled={setShown.isPending}
        onCheckedChange={(next) => setShown.mutate(next)}
      />
      <label htmlFor={switchId}>Shown on Devices</label>
    </div>
  );
}
