import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Check } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";

type SubscribeButtonProps = {
  channelId: string;
  channelTitle: string;
  subscribed: boolean;
};

// Subscribe shows a Channel's new Videos on Home and the Subscriptions page. Unsubscribing
// only hides them there; everything already kept stays in the Library.
export function SubscribeButton({
  channelId,
  channelTitle,
  subscribed,
}: SubscribeButtonProps): React.JSX.Element {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => trpcClient.subscriptions.set.mutate({ channelId, subscribed: !subscribed }),
    onSuccess: async (result) => {
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["channel", channelId] }),
        queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["library", "newFromSubscriptions"] }),
      ]);
      toast.success(
        subscribed ? `Unsubscribed from "${channelTitle}"` : `Subscribed to "${channelTitle}"`
      );
    },
    onError: () => {
      toast.error(subscribed ? "Failed to unsubscribe" : "Failed to subscribe");
    },
  });

  if (!subscribed) {
    return (
      <Button
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="flex items-center gap-2"
      >
        <Bell className="h-4 w-4" />
        Subscribe
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="group flex items-center gap-2"
      title="Unsubscribe"
    >
      <Check className="h-4 w-4" />
      <span className="group-hover:hidden group-focus-visible:hidden">Subscribed</span>
      <span className="hidden group-hover:inline group-focus-visible:inline">Unsubscribe</span>
    </Button>
  );
}
