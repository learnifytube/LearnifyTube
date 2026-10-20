import React, { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AudiobookCover } from "./components/AudiobookCover";
import { AudiobookOnDevices } from "./components/AudiobookOnDevices";
import { EditAudiobookDialog } from "./components/EditAudiobookDialog";
import { SortableTrackList } from "./components/SortableTrackList";
import { formatListeningTime } from "./format";

type AudiobookDetail = NonNullable<Awaited<ReturnType<typeof trpcClient.audiobooks.get.query>>>;

// A Track's path shown from the book's folder, e.g. "CD 1/Track 01.mp3".
const insideFolder = (folder: string, filePath: string): string =>
  filePath.startsWith(folder) ? filePath.slice(folder.length).replace(/^[\\/]/, "") : filePath;

const rescanSummary = ({ added, missing }: { added: number; missing: number }): string => {
  const parts = [
    added > 0 && `${added} new ${added === 1 ? "Track" : "Tracks"}`,
    missing > 0 && `${missing} missing`,
  ].filter(Boolean);
  return parts.length ? `Rescanned: ${parts.join(", ")}` : "Rescanned: nothing changed";
};

export default function AudiobookPage(): React.JSX.Element {
  const { id } = useSearch({ from: "/audiobook" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingForget, setConfirmingForget] = useState(false);
  const queryKey = ["audiobooks", "get", id];
  const bookQuery = useQuery({
    queryKey,
    queryFn: () => trpcClient.audiobooks.get.query({ id }),
    enabled: Boolean(id),
  });
  const book = bookQuery.data;
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: ["audiobooks"] });

  const reorder = useMutation({
    mutationFn: (tracks: AudiobookDetail["tracks"]) =>
      trpcClient.audiobooks.reorderTracks.mutate({ id, trackIds: tracks.map((t) => t.id) }),
    onMutate: (tracks) => {
      queryClient.setQueryData<AudiobookDetail | null>(queryKey, (current) =>
        current ? { ...current, tracks } : current
      );
    },
    onError: () => toast.error("Couldn't save the Track order"),
    onSettled: refresh,
  });

  const rescan = useMutation({
    mutationFn: () => trpcClient.audiobooks.rescan.mutate({ id }),
    onSuccess: async (result) => {
      await refresh();
      toast.success(rescanSummary(result));
    },
    onError: () => toast.error("Rescan failed"),
  });

  const forget = useMutation({
    mutationFn: () => trpcClient.audiobooks.forget.mutate({ id }),
    onSuccess: async () => {
      await navigate({ to: "/audiobooks" });
      await refresh();
      toast.success("Audiobook forgotten. Your files are untouched.");
    },
    onError: () => toast.error("Couldn't forget the Audiobook"),
  });

  return (
    <PageContainer>
      {bookQuery.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!bookQuery.isLoading && !book && (
        <p className="text-sm text-muted-foreground">This Audiobook is no longer here.</p>
      )}

      {book && (
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="w-48 shrink-0">
            <AudiobookCover coverPath={book.coverPath} title={book.title} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{book.title}</h1>
            {book.author && <p className="text-muted-foreground">{book.author}</p>}
            <p className="mt-1 break-all text-xs text-muted-foreground">{book.sourceFolder}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => rescan.mutate()}
                disabled={rescan.isPending}
              >
                <RefreshCw className={rescan.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                Rescan
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setConfirmingForget(true)}
              >
                <Trash2 className="h-4 w-4" />
                Forget
              </Button>
            </div>

            <AudiobookOnDevices id={book.id} sentToDevices={book.sentToDevices} />

            <h2 className="mt-6 text-sm font-semibold">{book.tracks.length} Tracks</h2>
            <p className="text-xs text-muted-foreground">Drag to change the Track order.</p>
            <SortableTrackList
              items={book.tracks}
              getKey={(track) => track.id}
              onReorder={(tracks) => reorder.mutate(tracks)}
              className="mt-2 divide-y rounded-lg border"
              itemClassName="px-3 py-2 text-sm"
              renderItem={(track, index) => (
                <>
                  <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={track.filePath}>
                    {insideFolder(book.sourceFolder, track.filePath)}
                  </span>
                  {track.missing && <span className="text-xs text-destructive">Missing</span>}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatListeningTime(track.durationSeconds)}
                  </span>
                </>
              )}
            />
          </div>
        </div>
      )}

      {book && editing && <EditAudiobookDialog book={book} onClose={() => setEditing(false)} />}

      <AlertDialog open={confirmingForget} onOpenChange={setConfirmingForget}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Forget this Audiobook?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from LearnifyTube only. Your audio files stay where they are, untouched;
              you can Import the folder again any time.
              {book?.sentToDevices &&
                " Devices it was sent to remove their copy, unless it was played there."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => forget.mutate()}>Forget</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
