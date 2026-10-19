import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AudiobookCover } from "./AudiobookCover";

type EditableAudiobook = {
  id: string;
  title: string;
  author: string | null;
  coverPath: string | null;
};

// Title, author and cover. Tracks only come from the folder, so they aren't edited here.
export function EditAudiobookDialog({
  book,
  onClose,
}: {
  book: EditableAudiobook;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? "");
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ["audiobooks"] });

  const save = useMutation({
    mutationFn: () =>
      trpcClient.audiobooks.update.mutate({ id: book.id, title, author: author.trim() || null }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    onError: () => toast.error("Couldn't save the Audiobook"),
  });

  const changeCover = useMutation({
    mutationFn: () => trpcClient.audiobooks.changeCover.mutate({ id: book.id }),
    onSuccess: refresh,
    onError: () => toast.error("Couldn't use that image as the cover"),
  });

  const removeCover = useMutation({
    mutationFn: () => trpcClient.audiobooks.removeCover.mutate({ id: book.id }),
    onSuccess: refresh,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Audiobook</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4">
          <div className="w-28 shrink-0 space-y-2">
            <AudiobookCover coverPath={book.coverPath} title={book.title} />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => changeCover.mutate()}
              disabled={changeCover.isPending}
            >
              Change cover
            </Button>
            {book.coverPath && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => removeCover.mutate()}
                disabled={removeCover.isPending}
              >
                Remove cover
              </Button>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="audiobook-title">Title</Label>
              <Input
                id="audiobook-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="audiobook-author">Author</Label>
              <Input
                id="audiobook-author"
                value={author}
                placeholder="Unknown author"
                onChange={(event) => setAuthor(event.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!title.trim() || save.isPending}
            className="gap-2"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
