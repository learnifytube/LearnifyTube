import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { trpcClient } from "@/utils/trpc";
import Thumbnail from "@/components/Thumbnail";

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
        </Link>
      ))}
    </div>
  );
}
