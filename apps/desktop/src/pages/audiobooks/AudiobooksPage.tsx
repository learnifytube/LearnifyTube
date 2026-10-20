import React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookAudio, FolderInput, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpcClient } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { AudiobookCover } from "./components/AudiobookCover";
import { AudiobookCardPlayButton } from "./components/AudiobookCardPlayButton";
import { ImportPreviewDialog } from "./components/ImportPreviewDialog";
import { formatListeningTime } from "./format";

export default function AudiobooksPage(): React.JSX.Element {
  const audiobooksQuery = useQuery({
    queryKey: ["audiobooks", "list"],
    queryFn: () => trpcClient.audiobooks.list.query(),
  });

  // Pick a folder, then read it for the preview. Nothing is saved yet.
  const startImport = useMutation({
    mutationFn: async () => {
      const folderPath = await trpcClient.audiobooks.pickFolder.mutate();
      if (!folderPath) return null;
      return trpcClient.audiobooks.previewImport.mutate({ folderPath });
    },
    onError: () => toast.error("Couldn't read that folder"),
  });

  const books = audiobooksQuery.data ?? [];

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Audiobooks</h1>
          <p className="text-sm text-muted-foreground">
            {audiobooksQuery.isLoading ? "Loading..." : `${books.length} Audiobooks`}
          </p>
        </div>
        <Button
          onClick={() => startImport.mutate()}
          disabled={startImport.isPending}
          className="gap-2"
        >
          {startImport.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FolderInput className="h-4 w-4" />
          )}
          {startImport.isPending ? "Reading folder..." : "Import"}
        </Button>
      </div>

      {!audiobooksQuery.isLoading && books.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <BookAudio className="h-10 w-10" />
          <p className="max-w-sm text-sm">
            Import a folder of audio files from your computer. Your files stay where they are.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {books.map((book) => (
            <div key={book.id} className="group relative">
              <Link to="/audiobook" search={{ id: book.id }} className="block">
                <AudiobookCover
                  coverPath={book.coverPath}
                  title={book.title}
                  className="transition-transform group-hover:scale-105"
                />
                <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-tight group-hover:text-primary">
                  {book.title}
                </h3>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    book.author,
                    `${book.trackCount} Tracks`,
                    formatListeningTime(book.durationSeconds),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </Link>
              <div className="pointer-events-none absolute inset-x-0 top-0 aspect-square">
                <AudiobookCardPlayButton bookId={book.id} title={book.title} />
              </div>
            </div>
          ))}
        </div>
      )}

      {startImport.data && (
        <ImportPreviewDialog
          key={startImport.data.folderPath}
          preview={startImport.data}
          onClose={() => startImport.reset()}
        />
      )}
    </PageContainer>
  );
}
