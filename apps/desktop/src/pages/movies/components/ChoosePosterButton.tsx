import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";

// Picks an image file as the Movie's or Series' poster; the image is copied, never moved.
export function ChoosePosterButton({
  kind,
  id,
}: {
  kind: "movie" | "series";
  id: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const choose = useMutation({
    mutationFn: () => trpcClient.movies.choosePoster.mutate({ kind, id }),
    onSuccess: async ({ changed }) => {
      if (changed) await queryClient.invalidateQueries({ queryKey: ["movies"] });
    },
    onError: () => toast.error("Couldn't use that image as the poster"),
  });
  return (
    <Button
      variant="outline"
      className="gap-2"
      disabled={choose.isPending}
      onClick={() => choose.mutate()}
    >
      <ImageIcon className="h-4 w-4" />
      Change poster
    </Button>
  );
}
