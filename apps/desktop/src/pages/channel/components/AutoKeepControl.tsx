import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LIBRARY_ONLY = "library-only";

type Settings = { enabled: boolean; listId?: string | null };

// Auto-keep for a subscribed Channel: on/off, the List new Videos also go into, and how the
// last check went.
export function AutoKeepControl({ channelId }: { channelId: string }): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["subscriptions", "autoKeep", channelId],
    queryFn: () => trpcClient.subscriptions.autoKeep.query({ channelId }),
  });
  const libraryQuery = useQuery({
    queryKey: ["library", "list"],
    queryFn: () => trpcClient.library.list.query(),
  });

  const mutation = useMutation({
    mutationFn: (settings: Settings) =>
      trpcClient.subscriptions.setAutoKeep.mutate({ channelId, ...settings }),
    onSuccess: async (result, settings) => {
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      if (settings.listId === undefined) {
        toast.success(settings.enabled ? "Auto-keep on" : "Auto-keep off");
      }
    },
    onError: () => toast.error("Failed to change Auto-keep"),
  });

  const status = statusQuery.data;
  if (!status) return null;

  const lists = libraryQuery.data?.lists ?? [];
  const selected = status.listDeleted ? "" : (status.listId ?? LIBRARY_ONLY);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Switch
          id="auto-keep"
          checked={status.enabled}
          onCheckedChange={(enabled) => mutation.mutate({ enabled })}
          disabled={mutation.isPending}
        />
        <Label htmlFor="auto-keep">Auto-keep new Videos</Label>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">into</span>
        <Select
          value={selected}
          onValueChange={(value) =>
            mutation.mutate({
              enabled: status.enabled,
              listId: value === LIBRARY_ONLY ? null : value,
            })
          }
          disabled={mutation.isPending}
        >
          <SelectTrigger className="h-8 w-44">
            <SelectValue placeholder="Pick a List" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LIBRARY_ONLY}>Library only</SelectItem>
            {lists.map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {status.listDeleted && <span className="text-destructive">List was deleted</span>}
      </div>

      {status.enabled && (
        <span className={status.lastCheckFailed ? "text-destructive" : "text-muted-foreground"}>
          {status.lastCheckedAt === null
            ? "Not checked yet"
            : status.lastCheckFailed
              ? "Last checked: failed"
              : `Last checked: ${formatDistanceToNow(status.lastCheckedAt, { addSuffix: true })}`}
        </span>
      )}
    </div>
  );
}
