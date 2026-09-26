import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { trpcClient } from "@/utils/trpc";
import Thumbnail from "@/components/Thumbnail";
import { Repeat } from "lucide-react";
import { cn } from "@/lib/utils";

type AutoKeep = Awaited<ReturnType<typeof trpcClient.subscriptions.list.query>>[number]["autoKeep"];

// Whether a Subscription auto-keeps, and where to, when it does
function AutoKeepBadge({ autoKeep }: { autoKeep: AutoKeep }): React.JSX.Element | null {
  if (!autoKeep.enabled) return null;
  const problem = autoKeep.listDeleted
    ? "List was deleted"
    : autoKeep.lastCheckFailed
      ? "last check failed"
      : null;
  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs",
        problem ? "text-destructive" : "text-muted-foreground"
      )}
    >
      <Repeat className="h-3 w-3" />
      Auto-keep{autoKeep.listName && !autoKeep.listDeleted ? ` → ${autoKeep.listName}` : ""}
      {problem && ` (${problem})`}
    </span>
  );
}

// The user's Subscriptions as a compact row of Channels, each linking to its Channel page
export function SubscribedChannels(): React.JSX.Element | null {
  const query = useQuery({
    queryKey: ["subscriptions", "list"],
    queryFn: () => trpcClient.subscriptions.list.query(),
  });

  if (query.isLoading) return null;

  const subscriptions = query.data ?? [];
  if (subscriptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Subscriptions yet. Open a Channel and press Subscribe to see its new Videos here.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {subscriptions.map((channel) => (
        <Link
          key={channel.channelId}
          to="/channel"
          search={{ channelId: channel.channelId }}
          className="flex items-center gap-2 rounded-full border px-2 py-1 text-sm hover:bg-accent"
        >
          <Thumbnail
            thumbnailPath={channel.thumbnailPath}
            thumbnailUrl={channel.thumbnailUrl}
            alt={channel.channelTitle}
            className="h-6 w-6 rounded-full object-cover"
            fallbackIcon={<div className="h-6 w-6 rounded-full bg-muted" />}
          />
          <span className="max-w-[12rem] truncate">{channel.channelTitle}</span>
          <AutoKeepBadge autoKeep={channel.autoKeep} />
        </Link>
      ))}
    </div>
  );
}
