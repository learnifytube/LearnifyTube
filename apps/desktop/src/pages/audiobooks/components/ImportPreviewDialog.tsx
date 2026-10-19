import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ImportMode } from "@/api/audiobooks/import-plan";
import { AudiobookCover } from "./AudiobookCover";
import { SortableTrackList } from "./SortableTrackList";
import { formatListeningTime } from "../format";

type ImportPreview = Awaited<ReturnType<typeof trpcClient.audiobooks.previewImport.mutate>>;
type PreviewBook = ImportPreview["plans"][ImportMode][number];
type PreviewTrack = PreviewBook["tracks"][number];

// A Track's path shown from its book's folder, e.g. "CD 1/Track 01.mp3".
const insideBook = (folder: string, path: string): string =>
  folder && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;

// Shows what Import would create; nothing is saved until the user confirms.
export function ImportPreviewDialog({
  preview,
  onClose,
}: {
  preview: ImportPreview;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ImportMode>(preview.suggestedMode);
  // Edited titles by book folder; untouched books keep their folder name.
  const [titles, setTitles] = useState<Record<string, string>>({});
  // Track paths the user dragged into a new order, by mode and then book folder.
  const [trackOrders, setTrackOrders] = useState<Record<ImportMode, Record<string, string[]>>>({
    "one-book": {},
    "each-subfolder": {},
  });
  const books = preview.plans[mode];

  const tracksOf = (book: PreviewBook): PreviewTrack[] => {
    const order = trackOrders[mode][book.folder];
    if (!order) return book.tracks;
    const byPath = new Map(book.tracks.map((track) => [track.path, track]));
    return order.flatMap((path) => byPath.get(path) ?? []);
  };

  const reorder = (book: PreviewBook, tracks: PreviewTrack[]): void =>
    setTrackOrders((current) => ({
      ...current,
      [mode]: { ...current[mode], [book.folder]: tracks.map((track) => track.path) },
    }));

  const confirm = useMutation({
    mutationFn: () =>
      trpcClient.audiobooks.confirmImport.mutate({
        folderPath: preview.folderPath,
        mode,
        titles,
        trackOrders: trackOrders[mode],
      }),
    onSuccess: async ({ ids }) => {
      await queryClient.invalidateQueries({ queryKey: ["audiobooks"] });
      toast.success(
        ids.length === 1 ? "Imported 1 Audiobook" : `Imported ${ids.length} Audiobooks`
      );
      onClose();
    },
    onError: () => toast.error("Import failed"),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !confirm.isPending && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Import Audiobooks</DialogTitle>
          <DialogDescription className="break-all">{preview.folderPath}</DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(value) => setMode(value as ImportMode)}>
          <TabsList>
            <TabsTrigger value="one-book">One Audiobook</TabsTrigger>
            <TabsTrigger value="each-subfolder">Each subfolder is an Audiobook</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {books.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No audio files found in this folder.
            </p>
          )}
          {books.map((book) => (
            <div key={book.folder} className="flex gap-4 rounded-lg border p-3">
              <div className="w-24 shrink-0">
                <AudiobookCover coverDataUrl={book.coverDataUrl} title={book.title} />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  aria-label="Title"
                  value={titles[book.folder] ?? book.title}
                  onChange={(event) =>
                    setTitles((current) => ({ ...current, [book.folder]: event.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {[
                    book.author ?? "Unknown author",
                    `${book.tracks.length} Tracks`,
                    formatListeningTime(
                      book.tracks.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0)
                    ),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <SortableTrackList
                  items={tracksOf(book)}
                  getKey={(track) => track.path}
                  onReorder={(tracks) => reorder(book, tracks)}
                  className="max-h-40 overflow-y-auto text-xs text-muted-foreground"
                  itemClassName="rounded px-1 py-0.5"
                  renderItem={(track, index) => (
                    <span className="min-w-0 flex-1 truncate" title={track.path}>
                      {index + 1}. {insideBook(book.folder, track.path)}
                    </span>
                  )}
                />
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={confirm.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => confirm.mutate()}
            disabled={books.length === 0 || confirm.isPending}
            className="gap-2"
          >
            {confirm.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {books.length === 1 ? "Import 1 Audiobook" : `Import ${books.length} Audiobooks`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
